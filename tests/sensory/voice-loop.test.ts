import { describe, it, expect } from 'vitest';
import { makeVoiceReply, describeVoiceReadiness } from '../../src/sensory/voice-loop.js';

describe('voice loop — readiness (fail-loud prereqs)', () => {
  it('is not speak-ready and warns about the voice when none is configured', () => {
    const r = describeVoiceReadiness({});
    expect(r.speakReady).toBe(false);
    expect(r.voice).toBeUndefined();
    expect(r.model).toBe('llama3.2');
    expect(r.warnings.some((w) => w.includes('CODEBUDDY_TTS_VOICE'))).toBe(true);
  });

  it('is speak-ready when a voice and model are configured', () => {
    const r = describeVoiceReadiness({
      CODEBUDDY_TTS_VOICE: '/voices/fr.onnx',
      CODEBUDDY_SENSORY_SPEAK_MODEL: 'qwen2.5:7b-instruct',
    });
    expect(r.speakReady).toBe(true);
    expect(r.voice).toBe('/voices/fr.onnx');
    expect(r.model).toBe('qwen2.5:7b-instruct');
    expect(r.warnings.some((w) => w.includes('HEAR but stay SILENT'))).toBe(false);
  });
});

describe('voice loop — heard → think → speak', () => {
  it('thinks a reply, synthesizes it, and plays the synthesized wav', async () => {
    const calls: string[] = [];
    let spoke = '';
    const onHeard = makeVoiceReply({
      replyFn: async (heard) => {
        calls.push(`reply:${heard}`);
        return 'Salut Patrice, on progresse.';
      },
      synth: async (text) => {
        calls.push(`synth:${text}`);
        return '/tmp/reply.wav';
      },
      play: async (wav) => {
        calls.push(`play:${wav}`);
      },
      onSpoke: (t) => {
        spoke = t;
      },
    });

    await onHeard('Bonjour, où en est le robot ?');

    expect(calls).toEqual([
      'reply:Bonjour, où en est le robot ?',
      'synth:Salut Patrice, on progresse.',
      'play:/tmp/reply.wav',
    ]);
    expect(spoke).toBe('Salut Patrice, on progresse.');
  });

  it('stays silent (no synth, no play) when the reply is empty', async () => {
    let synthCalls = 0;
    let playCalls = 0;
    const onHeard = makeVoiceReply({
      replyFn: async () => '   ', // whitespace → nothing to say
      synth: async () => {
        synthCalls += 1;
        return '/tmp/x.wav';
      },
      play: async () => {
        playCalls += 1;
      },
    });

    await onHeard('mmh');

    expect(synthCalls).toBe(0);
    expect(playCalls).toBe(0);
  });

  it('never throws when synth fails, and does not play', async () => {
    let playCalls = 0;
    const onHeard = makeVoiceReply({
      replyFn: async () => 'something',
      synth: async () => {
        throw new Error('piper not installed');
      },
      play: async () => {
        playCalls += 1;
      },
    });

    await expect(onHeard('hello')).resolves.toBeUndefined();
    expect(playCalls).toBe(0);
  });

  it('never throws when the think step fails', async () => {
    const onHeard = makeVoiceReply({
      replyFn: async () => {
        throw new Error('ollama down');
      },
      synth: async () => '/tmp/x.wav',
      play: async () => {},
    });

    await expect(onHeard('hello')).resolves.toBeUndefined();
  });
});
