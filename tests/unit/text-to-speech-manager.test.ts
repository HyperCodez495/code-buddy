import { describe, it, expect, vi } from 'vitest';
import { TextToSpeechManager } from '../../src/input/text-to-speech.js';
import { kokoroTtsService } from '../../src/utils/kokoro-tts.js';
import { execFile } from 'child_process';

// Mock child_process spawn
vi.mock('child_process', () => {
  return {
    spawn: vi.fn().mockImplementation(() => {
      return {
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'close') {
            callback(0); // Success
          }
        })
      };
    }),
    execFile: vi.fn().mockImplementation((command, args, callback) => {
      if (callback) {
        callback(null, '', '');
      }
      return {};
    })
  };
});

// Mock kokoro-tts service
vi.mock('../../src/utils/kokoro-tts.js', () => {
  return {
    kokoroTtsService: {
      generateSpeech: vi.fn().mockResolvedValue(Buffer.from('mock wav data'))
    }
  };
});

describe('TextToSpeechManager with Kokoro', () => {
  it('should speak using kokoro provider and play the generated audio file', async () => {
    const manager = new TextToSpeechManager({ provider: 'kokoro', enabled: true });

    // Trigger speak
    const speakPromise = manager.speak('Hello from Kokoro');
    await speakPromise;

    // Check that kokoro service was called
    expect(kokoroTtsService.generateSpeech).toHaveBeenCalledWith('Hello from Kokoro', 'af_bella');

    // Check that audio player was called with a native argv, not a shell command string
    expect(execFile).toHaveBeenCalled();
  });
});
