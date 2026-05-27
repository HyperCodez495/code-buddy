import { KokoroTTS } from 'kokoro-js';
import { logger } from './logger.js';

export class KokoroTTSService {
  private tts: KokoroTTS | null = null;
  private initializing: Promise<void> | null = null;

  private async init() {
    if (this.tts) return;
    if (this.initializing) {
      return this.initializing;
    }

    this.initializing = (async () => {
      logger.info('[KokoroTTS] Initializing Kokoro TTS (downloading model if not cached)...');
      this.tts = await KokoroTTS.from_pretrained('hexgrad/Kokoro-82M', {
        dtype: 'q8',
        device: 'cpu',
      });
      logger.info('[KokoroTTS] Kokoro TTS successfully initialized');
    })();

    await this.initializing;
    this.initializing = null;
  }

  public async generateSpeech(text: string, voice: string = 'af_bella'): Promise<Buffer> {
    await this.init();
    if (!this.tts) {
      throw new Error('TTS engine not initialized');
    }

    logger.info(`[KokoroTTS] Generating speech for text length: ${text.length} with voice: ${voice}`);
    const result = await this.tts.generate(text, { voice: voice as any });

    // Convert Float32Array to 16-bit PCM WAV
    return this.float32ArrayToWav(result.audio, result.sampling_rate);
  }

  private float32ArrayToWav(audioData: Float32Array, sampleRate: number): Buffer {
    const numChannels = 1; // Kokoro outputs mono audio
    const byteRate = sampleRate * numChannels * 2;
    const blockAlign = numChannels * 2;
    const dataSize = audioData.length * 2;
    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF chunk descriptor
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);

    // fmt sub-chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
    buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
    buffer.writeUInt16LE(numChannels, 22); // NumChannels
    buffer.writeUInt32LE(sampleRate, 24); // SampleRate
    buffer.writeUInt32LE(byteRate, 28); // ByteRate
    buffer.writeUInt16LE(blockAlign, 32); // BlockAlign
    buffer.writeUInt16LE(16, 34); // BitsPerSample

    // data sub-chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Write PCM data
    let offset = 44;
    for (let i = 0; i < audioData.length; i++) {
      let s = Math.max(-1, Math.min(1, audioData[i]));
      const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
      buffer.writeInt16LE(val, offset);
      offset += 2;
    }

    return buffer;
  }
}

export const kokoroTtsService = new KokoroTTSService();
