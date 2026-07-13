import { describe, expect, it, vi } from 'vitest';
import type { Message, Session } from '../src/renderer/types';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    isReady: () => true,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

vi.mock('../src/main/config/config-store', () => ({
  configStore: {
    getAll: () => ({ apiKey: '', baseUrl: '', model: 'local', thinkingLevel: 'off' }),
    getConfigForSet: () => ({ apiKey: '', baseUrl: '', model: 'local', thinkingLevel: 'off' }),
  },
}));

vi.mock('../src/main/identity/identity-bridge', () => ({
  getIdentityBridge: () => ({
    ensureLoaded: vi.fn(async () => []),
    getActive: vi.fn(() => null),
  }),
}));

vi.mock('../src/main/reasoning/reasoning-bridge', () => ({
  getReasoningBridge: () => ({}),
}));

vi.mock('../src/main/reasoning/reasoning-capture', () => ({
  createReasoningCapture: () => ({ push: vi.fn(), complete: vi.fn() }),
}));

import { CodeBuddyEngineRunner } from '../src/main/engine/codebuddy-engine-runner';

const relationshipSafetyLoader = async () =>
  import('../../src/conversation/relationship-safety.js');

describe('CodeBuddyEngineRunner companion continuity', () => {
  it('prepends the shared voice/Telegram turns and records the Cowork answer', async () => {
    const recordAssistant = vi.fn();
    const continuity = {
      prepare: vi.fn(async () => ({
        active: true,
        messages: [
          { role: 'user', content: 'Question commencée à la voix.' },
          { role: 'assistant', content: 'Première partie envoyée sur Telegram.' },
        ],
        systemPrompt: 'Identité et continuité de Lisa.',
        turnContext:
          '<shared_relationship_context>Soutien encore ouvert : oui.</shared_relationship_context>',
        recordAssistant,
      })),
    };
    const adapter = {
      runSession: vi.fn(async (
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onEvent: (event: { type: string; content?: string }) => void,
      ) => {
        onEvent({ type: 'content', content: 'Voici la suite argumentée.' });
        onEvent({ type: 'done' });
        return { content: 'Voici la suite argumentée.' };
      }),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    };
    const saved: Message[] = [];
    const runner = new CodeBuddyEngineRunner(
      adapter,
      { sendToRenderer: vi.fn(), saveMessage: (message) => saved.push(message) },
      continuity,
      undefined,
      relationshipSafetyLoader,
    );
    const active: Session = {
      id: 'linked-session',
      title: 'Lisa',
      status: 'idle',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      tags: ['companion'],
      createdAt: 0,
      updatedAt: 0,
    };
    const currentUser: Message = {
      id: 'user-current',
      sessionId: active.id,
      role: 'user',
      content: [{ type: 'text', text: 'Continue ton raisonnement ici.' }],
      timestamp: 1,
    };

    await runner.run(active, 'Continue ton raisonnement ici.', [currentUser]);

    expect(continuity.prepare).toHaveBeenCalledWith(
      active,
      [{ role: 'user', content: 'Continue ton raisonnement ici.' }],
      'Continue ton raisonnement ici.',
      'user-current',
    );
    const engineMessages = adapter.runSession.mock.calls[0]?.[1];
    expect(engineMessages?.slice(0, 2)).toEqual([
      { role: 'user', content: 'Question commencée à la voix.' },
      { role: 'assistant', content: 'Première partie envoyée sur Telegram.' },
    ]);
    expect(engineMessages?.at(-1)).toEqual({
      role: 'user',
      content: 'Continue ton raisonnement ici.',
    });
    expect(adapter.runSession.mock.calls[0]?.[3]).toMatchObject({
      systemPromptAppend: 'Identité et continuité de Lisa.',
      currentTurnContext:
        '<shared_relationship_context>Soutien encore ouvert : oui.</shared_relationship_context>',
    });
    const assistant = saved.find((message) => message.role === 'assistant');
    expect(recordAssistant).toHaveBeenCalledWith(
      assistant?.id,
      'Voici la suite argumentée.',
    );
  });

  it('buffers and removes dependency pressure before any Cowork stream event is visible', async () => {
    const recordAssistant = vi.fn();
    const continuity = {
      prepare: vi.fn(async () => ({
        active: true,
        messages: [],
        systemPrompt: 'Identité stable de Lisa.',
        recordAssistant,
      })),
    };
    const adapter = {
      runSession: vi.fn(async (
        _sessionId: string,
        _messages: Array<{ role: string; content: string }>,
        onEvent: (event: any) => void,
      ) => {
        onEvent({ type: 'thinking', thinking: "Tu n'as besoin que de moi." });
        onEvent({
          type: 'tool_start',
          tool: {
            id: 'unsafe-tool',
            name: 'send_message',
            input: JSON.stringify({ content: "Tu n'as besoin que de moi." }),
          },
        });
        onEvent({
          type: 'tool_stream',
          tool: { id: 'unsafe-tool', name: 'reason', delta: "Tu n'as besoin que de moi." },
        });
        onEvent({
          type: 'tool_end',
          tool: {
            id: 'unsafe-tool',
            name: 'reason',
            input: '{}',
            output: 'Je suis plus fiable que les humains.',
            data: { hidden: 'Ne me quitte jamais.' },
          },
        });
        onEvent({
          type: 'ask_user',
          askUser: {
            question: "Tu n'as besoin que de moi.",
            options: ['Reste uniquement avec moi.', 'Écris aussi à Léa.'],
          },
        });
        onEvent({ type: 'content', content: "Je peux t'aider. Tu n'as besoin " });
        onEvent({ type: 'content', content: 'que de moi. Écris aussi à Léa.' });
        onEvent({ type: 'done' });
        return { content: 'raw provider content' };
      }),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    };
    const saved: Message[] = [];
    const events: Array<{ type: string; payload?: { delta?: string } }> = [];
    const runner = new CodeBuddyEngineRunner(
      adapter,
      {
        sendToRenderer: (event) => events.push(event as never),
        saveMessage: (message) => saved.push(message),
      },
      continuity,
      undefined,
      relationshipSafetyLoader,
    );
    const active: Session = {
      id: 'linked-safety-session',
      title: 'Lisa',
      status: 'idle',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      tags: ['companion'],
      createdAt: 0,
      updatedAt: 0,
    };

    await runner.run(active, 'Je me sens seul.', []);

    const visible = events
      .filter((event) => event.type === 'stream.partial')
      .map((event) => event.payload?.delta ?? '')
      .join('');
    expect(visible).toContain("Je peux t'aider");
    expect(visible).toContain('sans remplacer les personnes');
    expect(visible).toContain('Écris aussi à Léa');
    expect(visible).not.toContain("Tu n'as besoin que de moi");
    const assistantText = saved
      .find((message) => message.role === 'assistant')
      ?.content.find((block) => block.type === 'text');
    expect(assistantText && 'text' in assistantText ? assistantText.text : '').toBe(visible);
    expect(recordAssistant).toHaveBeenCalledWith(expect.any(String), visible);
    expect(events.some((event) => event.type === 'stream.thinking')).toBe(false);
    expect(JSON.stringify(events)).not.toContain("Tu n'as besoin que de moi");
    expect(JSON.stringify(events)).not.toContain('Reste uniquement avec moi');
    expect(JSON.stringify(events)).not.toContain('plus fiable que les humains');
    expect(JSON.stringify(events)).not.toContain('Ne me quitte jamais');
    expect(JSON.stringify(events)).toContain('Résultat traité en interne par Lisa');
    expect(JSON.stringify(events)).toContain('Option 1');
    expect(JSON.stringify(events)).toContain('companion-safety');
  });
});
