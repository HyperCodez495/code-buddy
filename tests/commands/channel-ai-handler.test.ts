/**
 * GAP-7 — inbound two-way messaging roundtrip.
 *
 * `registerAIMessageHandler` is the inbound receiver loop: a channel message is
 * gated by DM pairing, routed, run through the agent, and the reply is delivered
 * back over the same channel. The audit flagged that there was no E2E test of the
 * full roundtrip or of same-session follow-up reuse. These tests cover both,
 * driving a fake ChannelManager/channel against fully-mocked core + agent.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  return {
    checkDMPairing: vi.fn(),
    resolveRoute: vi.fn(),
    getRouteAgentConfig: vi.fn(),
    getDMPairing: vi.fn(),
    processUserMessage: vi.fn(),
    setChatHistory: vi.fn(),
    setMessages: vi.fn(),
    sessions: new Map<string, any>(),
    loadSession: vi.fn(),
    saveSession: vi.fn(),
    resumeSession: vi.fn(),
    convertMessagesToChatEntries: vi.fn(),
    setChannelBotId: vi.fn(),
    getChatHistory: vi.fn(),
  };
});

vi.mock('../../src/channels/core.js', () => ({
  checkDMPairing: hoisted.checkDMPairing,
  resolveRoute: hoisted.resolveRoute,
  getRouteAgentConfig: hoisted.getRouteAgentConfig,
  getDMPairing: hoisted.getDMPairing,
}));

vi.mock('../../src/agent/codebuddy-agent.js', () => {
  class CodeBuddyAgent {
    historyManager = {
      setChatHistory: hoisted.setChatHistory,
      setMessages: hoisted.setMessages,
    };
    constructor(_apiKey?: string, _baseUrl?: string, _model?: string, _maxRounds?: number) {}
    getSessionStore() {
      return {
        loadSession: hoisted.loadSession,
        saveSession: hoisted.saveSession,
        resumeSession: hoisted.resumeSession,
        convertMessagesToChatEntries: hoisted.convertMessagesToChatEntries,
      };
    }
    processUserMessage = hoisted.processUserMessage;
    setChannelBotId = hoisted.setChannelBotId;
    getChatHistory = hoisted.getChatHistory;
  }
  return { CodeBuddyAgent };
});

import {
  registerAIMessageHandler,
  __resetChannelAIHandlerForTests,
} from '../../src/commands/handlers/channel-handlers.js';

type InboundHandler = (message: any, channel: any) => Promise<void>;

function makeManager() {
  let handler: InboundHandler | null = null;
  return {
    onMessage: (cb: InboundHandler) => { handler = cb; },
    emit: async (message: any, channel: any) => {
      if (!handler) throw new Error('no handler registered');
      await handler(message, channel);
    },
  };
}

function makeMessage(content: string, sessionKey = 'sess-1') {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    content,
    channel: { id: 'chan-42' },
    sessionKey,
  };
}

describe('registerAIMessageHandler inbound roundtrip (GAP-7)', () => {
  beforeEach(() => {
    __resetChannelAIHandlerForTests();
    vi.clearAllMocks();
    hoisted.sessions.clear();
    process.env.GROK_API_KEY = 'test-key';

    // Default happy path: approved pairing, simple route, in-memory session store.
    hoisted.checkDMPairing.mockResolvedValue({ approved: true });
    hoisted.resolveRoute.mockReturnValue({ name: 'default' });
    hoisted.getRouteAgentConfig.mockReturnValue({ model: 'grok-3-latest', maxToolRounds: 5 });
    hoisted.getDMPairing.mockReturnValue({ getPairingMessage: () => 'Reply with code 123456 to pair.' });
    hoisted.processUserMessage.mockResolvedValue([{ role: 'assistant', content: 'Here is your answer.' }]);
    hoisted.loadSession.mockImplementation(async (key: string) => hoisted.sessions.get(key) ?? null);
    hoisted.saveSession.mockImplementation(async (s: any) => { hoisted.sessions.set(s.id, s); });
    hoisted.resumeSession.mockResolvedValue(undefined);
    hoisted.convertMessagesToChatEntries.mockImplementation((msgs: any[]) => msgs.map((m) => ({ ...m, chat: true })));
    hoisted.getChatHistory.mockReturnValue([
      { type: 'user', content: 'latest question', timestamp: new Date('2026-01-01T00:00:00.000Z') },
      { type: 'assistant', content: 'Here is your answer.', timestamp: new Date('2026-01-01T00:00:01.000Z') },
    ]);
  });

  it('runs message → pairing → route → agent → reply and delivers the response', async () => {
    const manager = makeManager();
    await registerAIMessageHandler(manager as any);

    const send = vi.fn().mockResolvedValue(undefined);
    const msg = makeMessage('What is 2 + 2?');
    await manager.emit(msg, { send });

    // Agent ran the inbound content…
    expect(hoisted.processUserMessage).toHaveBeenCalledWith('What is 2 + 2?');
    // …and the reply went back over the same channel, threaded to the message.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      channelId: 'chan-42',
      content: 'Here is your answer.',
      replyTo: msg.id,
    });
  });

  it('blocks unpaired senders: sends the pairing prompt and does NOT run the agent', async () => {
    hoisted.checkDMPairing.mockResolvedValue({ approved: false, code: '123456' });

    const manager = makeManager();
    await registerAIMessageHandler(manager as any);

    const send = vi.fn().mockResolvedValue(undefined);
    await manager.emit(makeMessage('hello'), { send });

    expect(hoisted.processUserMessage).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].content).toContain('pair');
  });

  it('reuses the same session across follow-up messages (no re-create)', async () => {
    const manager = makeManager();
    await registerAIMessageHandler(manager as any);

    const send = vi.fn().mockResolvedValue(undefined);

    // First inbound message creates and persists the session.
    await manager.emit(makeMessage('first', 'sess-shared'), { send });
    // Follow-up on the same sessionKey must reuse the cached agent, not re-create it.
    await manager.emit(makeMessage('follow-up', 'sess-shared'), { send });

    expect(hoisted.loadSession).toHaveBeenCalledTimes(3);
    expect(hoisted.loadSession).toHaveBeenNthCalledWith(1, 'sess-shared');
    expect(hoisted.loadSession).toHaveBeenNthCalledWith(2, 'sess-shared');
    expect(hoisted.loadSession).toHaveBeenNthCalledWith(3, 'sess-shared');
    // The cached agent handles both turns, and each completed turn is persisted.
    expect(hoisted.saveSession).toHaveBeenCalledTimes(2);
    expect(hoisted.resumeSession).not.toHaveBeenCalled();
    expect(hoisted.processUserMessage).toHaveBeenNthCalledWith(1, 'first');
    expect(hoisted.processUserMessage).toHaveBeenNthCalledWith(2, 'follow-up');
  });

  it('restores prior history when resuming a session that already has messages', async () => {
    const priorMessages = [
      { type: 'user', content: 'earlier question' },
      { type: 'assistant', content: 'earlier answer' },
    ];
    hoisted.sessions.set('sess-resume', {
      id: 'sess-resume',
      name: 'existing',
      model: 'grok-3-latest',
      messages: priorMessages,
      workingDirectory: process.cwd(),
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    });

    const manager = makeManager();
    await registerAIMessageHandler(manager as any);

    const send = vi.fn().mockResolvedValue(undefined);
    await manager.emit(makeMessage('next', 'sess-resume'), { send });

    // Session is restored before the turn and persisted again after the reply.
    expect(hoisted.saveSession).toHaveBeenCalledTimes(1);
    // Prior history was restored into the agent before the new turn.
    expect(hoisted.convertMessagesToChatEntries).toHaveBeenCalledWith(priorMessages);
    expect(hoisted.setMessages).toHaveBeenCalledWith([
      { role: 'user', content: 'earlier question' },
      { role: 'assistant', content: 'earlier answer' },
    ]);
    expect(hoisted.processUserMessage).toHaveBeenCalledWith('next');
  });
});
