import { describe, it, expect, vi } from 'vitest';
import { KokoroTTSService } from '../../src/utils/kokoro-tts.js';

// Mock kokoro-js
vi.mock('kokoro-js', () => {
  return {
    KokoroTTS: {
      from_pretrained: vi.fn().mockResolvedValue({
        generate: vi.fn().mockResolvedValue({
          audio: new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0]),
          sampling_rate: 24000
        })
      })
    }
  };
});

describe('KokoroTTSService', () => {
  it('should initialize and generate a WAV PCM buffer from text', async () => {
    const service = new KokoroTTSService();
    const buffer = await service.generateSpeech('Hello world', 'af_bella');

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(54); // 44 bytes header + 10 bytes PCM data
    expect(buffer.toString('utf8', 0, 4)).toBe('RIFF');
    expect(buffer.toString('utf8', 8, 12)).toBe('WAVE');
    expect(buffer.readUInt32LE(24)).toBe(24000); // Sample rate
    expect(buffer.readUInt16LE(22)).toBe(1); // Mono
    expect(buffer.readUInt16LE(34)).toBe(16); // 16-bit
  });
});
