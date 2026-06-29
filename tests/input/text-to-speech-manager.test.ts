import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TTSConfig } from '../../src/input/text-to-speech.js';

const mocks = vi.hoisted(() => ({
  commandExists: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../../src/utils/command-exists.js', () => ({
  commandExists: mocks.commandExists,
}));

vi.mock('child_process', () => ({
  spawn: mocks.spawn,
}));

import { TextToSpeechManager } from '../../src/input/text-to-speech.js';

function setTtsConfig(manager: TextToSpeechManager, config: Partial<TTSConfig>): void {
  const target = manager as unknown as { config: TTSConfig };
  target.config = { ...manager.getConfig(), ...config };
}

function fakeFailingProcess(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin?: { write: () => void; end: () => void };
  kill: () => void;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin?: { write: () => void; end: () => void };
    kill: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: () => {}, end: () => {} };
  child.kill = () => {};
  setImmediate(() => child.emit('close', 1));
  return child;
}

describe('TextToSpeechManager error handling', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not throw when provider playback fails and no error listener is registered', async () => {
    mocks.commandExists.mockResolvedValue(true);
    mocks.spawn.mockReturnValue(fakeFailingProcess());
    const manager = new TextToSpeechManager({ enabled: true, provider: 'espeak' });
    setTtsConfig(manager, { enabled: true, provider: 'espeak' });

    try {
      await expect(manager.speak('bonjour', 'fr')).resolves.toBeUndefined();
      expect(manager.getState().isSpeaking).toBe(false);
    } finally {
      manager.dispose();
    }
  });
});
