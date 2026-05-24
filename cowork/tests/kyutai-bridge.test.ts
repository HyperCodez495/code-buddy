import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { KyutaiBridge, __test } from '../src/main/voice/kyutai-bridge';

const {
  SAMPLE_RATE,
  buildPcm16Wav,
  compactTranscript,
  decodeMsgPack,
  encodeMsgPack,
  float32FromBufferLE,
  normalizeBaseUrl,
  providerEnabled,
} = __test;

describe('KyutaiBridge — provider flags and URLs', () => {
  it('accepts kyutai, dsm, and moshi provider names', () => {
    expect(providerEnabled('kyutai')).toBe(true);
    expect(providerEnabled('DSM')).toBe(true);
    expect(providerEnabled(' moshi ')).toBe(true);
    expect(providerEnabled('piper')).toBe(false);
    expect(providerEnabled(undefined)).toBe(false);
  });

  it('normalizes HTTP endpoints into WebSocket endpoints', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:8080/')).toBe('ws://127.0.0.1:8080');
    expect(normalizeBaseUrl('https://voice.example.test')).toBe('wss://voice.example.test');
    expect(normalizeBaseUrl('ws://127.0.0.1:8080///')).toBe('ws://127.0.0.1:8080');
  });
});

describe('KyutaiBridge — diagnostics', () => {
  it('probes a reachable Kyutai websocket endpoint without sending audio', async () => {
    const previousVoiceProvider = process.env.COWORK_VOICE_PROVIDER;
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('WebSocketServer did not expose a TCP port');
    }

    try {
      process.env.COWORK_VOICE_PROVIDER = 'kyutai';
      const bridge = new KyutaiBridge({
        baseUrl: `ws://127.0.0.1:${address.port}`,
        ffmpegBinary: process.execPath,
      });
      const diagnostics = await bridge.diagnostics({
        includeTts: false,
        timeoutMs: 1000,
      });

      expect(diagnostics.sttEnabled).toBe(true);
      expect(diagnostics.ttsEnabled).toBe(true);
      expect(diagnostics.ffmpegFound).toBe(existsSync(process.execPath));
      expect(diagnostics.sttProbe?.ok).toBe(true);
      expect(diagnostics.sttProbe?.endpoint).toContain('/api/asr-streaming');
      expect(diagnostics.ttsProbe).toBeUndefined();
    } finally {
      if (previousVoiceProvider === undefined) delete process.env.COWORK_VOICE_PROVIDER;
      else process.env.COWORK_VOICE_PROVIDER = previousVoiceProvider;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('KyutaiBridge — minimal MessagePack codec', () => {
  it('round-trips the STT audio frame shape', () => {
    const frame = {
      type: 'Audio',
      pcm: [0, 0.25, -0.5, 1],
    };
    const decoded = decodeMsgPack(encodeMsgPack(frame)) as typeof frame;
    expect(decoded.type).toBe('Audio');
    expect(decoded.pcm).toHaveLength(4);
    expect(decoded.pcm[1]).toBeCloseTo(0.25, 4);
    expect(decoded.pcm[2]).toBeCloseTo(-0.5, 4);
  });

  it('round-trips text and marker frames', () => {
    expect(decodeMsgPack(encodeMsgPack({ type: 'Text', text: 'bonjour' }))).toEqual({
      type: 'Text',
      text: 'bonjour',
    });
    expect(decodeMsgPack(encodeMsgPack({ type: 'Marker', id: 0 }))).toEqual({
      type: 'Marker',
      id: 0,
    });
  });
});

describe('KyutaiBridge — audio helpers', () => {
  it('reads ffmpeg f32le output into float samples', () => {
    const bytes = Buffer.alloc(12);
    bytes.writeFloatLE(0, 0);
    bytes.writeFloatLE(0.5, 4);
    bytes.writeFloatLE(-1, 8);
    const pcm = float32FromBufferLE(bytes);
    expect(Array.from(pcm)).toEqual([0, 0.5, -1]);
  });

  it('builds a 24 kHz PCM16 WAV for renderer playback', () => {
    const wav = buildPcm16Wav(Float32Array.from([-1, 0, 1]));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(wav.readUInt32LE(40)).toBe(6);
    expect(wav.readInt16LE(44)).toBe(-32768);
    expect(wav.readInt16LE(46)).toBe(0);
    expect(wav.readInt16LE(48)).toBe(32767);
  });
});

describe('KyutaiBridge — transcript formatting', () => {
  it('compacts word frames into normal spoken text', () => {
    expect(compactTranscript([
      { text: 'Bonjour' },
      { text: ',' },
      { text: 'Patrice' },
      { text: '!' },
    ])).toBe('Bonjour, Patrice!');
  });
});
