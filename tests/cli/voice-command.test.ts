import { beforeEach, describe, it, expect, vi } from 'vitest';

const continuity = vi.hoisted(() => ({
  bridge: {
    history: vi.fn(() => [
      { role: 'user' as const, content: 'Tour précédent sur Telegram.' },
    ]),
    recordVoiceTurn: vi.fn(async () => true),
    flush: vi.fn(async () => undefined),
  },
  hybridOptions: undefined as Record<string, unknown> | undefined,
  hybridDispose: vi.fn(),
}));

vi.mock('../../src/conversation/cross-channel-bridge.js', () => ({
  getCrossChannelConversationBridge: () => continuity.bridge,
}));

vi.mock('../../src/sensory/agent-reply.js', () => ({
  makeAgentReply: vi.fn(() => async () => 'agent result'),
}));

vi.mock('../../src/sensory/hybrid-reply.js', () => ({
  makeHybridReply: vi.fn((options: Record<string, unknown>) => {
    continuity.hybridOptions = options;
    return Object.assign(
      async (heard: string) => `Réponse à ${heard}`,
      { dispose: continuity.hybridDispose },
    );
  }),
}));

vi.mock('../../src/sensory/voice-loop.js', () => ({
  makeVoiceReply: vi.fn((options: {
    replyFn: (heard: string) => Promise<string>;
    onConversationTurn?: (turn: { role: 'user' | 'assistant'; content: string }) => Promise<void>;
  }) => async (heard: string) => {
    await options.onConversationTurn?.({ role: 'user', content: heard });
    const answer = await options.replyFn(heard);
    await options.onConversationTurn?.({ role: 'assistant', content: answer });
  }),
}));

import { runVoiceCommand } from '../../src/cli/voice-command.js';

describe('buddy voice — push-to-talk loop', () => {
  beforeEach(() => {
    continuity.bridge.history.mockClear();
    continuity.bridge.recordVoiceTurn.mockClear();
    continuity.bridge.flush.mockClear();
    continuity.hybridDispose.mockClear();
    continuity.hybridOptions = undefined;
  });

  it('uses the guarded default posture unless plan is explicitly requested', async () => {
    const output: string[] = [];
    await runVoiceCommand({
      once: true,
      print: (line) => output.push(line),
      record: async () => '/tmp/x.wav',
      transcribe: async () => '',
      onHeard: async () => {},
    });
    expect(output[0]).toContain('posture: default');
    expect(output[0]).toContain('guarded workspace sandbox');

    output.length = 0;
    await runVoiceCommand({
      once: true,
      permissionMode: 'plan',
      print: (line) => output.push(line),
      record: async () => '/tmp/x.wav',
      transcribe: async () => '',
      onHeard: async () => {},
    });
    expect(output[0]).toContain('posture: plan (read-only)');
  });

  it('records → transcribes → handles (in order), once', async () => {
    const order: string[] = [];
    await runVoiceCommand({
      once: true,
      print: () => {},
      record: async () => {
        order.push('record');
        return '/tmp/x.wav';
      },
      transcribe: async (wav) => {
        order.push(`transcribe:${wav}`);
        return 'lis le package.json';
      },
      onHeard: async (text) => {
        order.push(`heard:${text}`);
      },
    });
    expect(order).toEqual(['record', 'transcribe:/tmp/x.wav', 'heard:lis le package.json']);
  });

  it('does not call onHeard when the transcript is empty', async () => {
    let heard = 0;
    await runVoiceCommand({
      once: true,
      print: () => {},
      record: async () => '/tmp/x.wav',
      transcribe: async () => '   ',
      onHeard: async () => {
        heard += 1;
      },
    });
    expect(heard).toBe(0);
  });

  it('never throws when a round fails (record error)', async () => {
    await expect(
      runVoiceCommand({
        once: true,
        print: () => {},
        record: async () => {
          throw new Error('no mic');
        },
        transcribe: async () => 'unused',
        onHeard: async () => {},
      }),
    ).resolves.toBeUndefined();
  });

  it('loops maxRounds times', async () => {
    let rounds = 0;
    await runVoiceCommand({
      maxRounds: 3,
      print: () => {},
      record: async () => {
        rounds += 1;
        return '/tmp/x.wav';
      },
      transcribe: async () => '',
      onHeard: async () => {},
    });
    expect(rounds).toBe(3);
  });

  it('joins and flushes the shared Telegram conversation by default', async () => {
    await runVoiceCommand({
      once: true,
      print: () => {},
      record: async () => '/tmp/x.wav',
      transcribe: async () => 'On continue ici.',
    });

    const sharedHistory = continuity.hybridOptions?.sharedHistory as (() => unknown[]) | undefined;
    expect(sharedHistory?.()).toEqual([
      { role: 'user', content: 'Tour précédent sur Telegram.' },
    ]);
    expect(continuity.bridge.recordVoiceTurn.mock.calls).toEqual([
      [{ role: 'user', content: 'On continue ici.' }],
      [{ role: 'assistant', content: 'Réponse à On continue ici.' }],
    ]);
    expect(continuity.bridge.flush).toHaveBeenCalledTimes(2);
    expect(continuity.hybridDispose).toHaveBeenCalledTimes(1);
  });
});
