import { describe, it, expect } from 'vitest';
import { runVoiceCommand } from '../../src/cli/voice-command.js';

describe('buddy voice — push-to-talk loop', () => {
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
});
