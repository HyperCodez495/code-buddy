import { describe, expect, it, vi } from 'vitest';
import { SystemDictationService } from '../src/main/voice/system-dictation.js';

function fakeClipboard(initial = 'before') {
  let value = initial;
  return {
    readText: vi.fn(() => value),
    writeText: vi.fn((next: string) => { value = next; }),
    current: () => value,
  };
}

describe('SystemDictationService', () => {
  it('pastes on Wayland without putting transcript text in process arguments', async () => {
    const clipboard = fakeClipboard();
    const execFile = vi.fn((_file, _args, callback) => callback(null));
    let restore: (() => void) | undefined;
    const service = new SystemDictationService({
      platform: 'linux',
      env: { WAYLAND_DISPLAY: 'wayland-0' },
      clipboard,
      execFile,
      commandExists: async (command) => command === 'wtype',
      schedule: (callback) => { restore = callback; },
    });

    await expect(service.paste(' Bonjour Patrice. ')).resolves.toEqual({
      ok: true,
      copied: true,
      pasted: true,
      mechanism: 'wtype',
    });
    expect(clipboard.current()).toBe('Bonjour Patrice.');
    expect(execFile).toHaveBeenCalledWith(
      'wtype',
      ['-M', 'ctrl', '-P', 'v', '-p', 'v', '-m', 'ctrl'],
      expect.any(Function)
    );
    expect(JSON.stringify(execFile.mock.calls)).not.toContain('Bonjour Patrice');
    restore?.();
    expect(clipboard.current()).toBe('before');
  });

  it('does not overwrite a clipboard value copied by the user after dictation', async () => {
    const clipboard = fakeClipboard('before');
    let restore: (() => void) | undefined;
    const service = new SystemDictationService({
      platform: 'linux',
      env: {},
      clipboard,
      execFile: (_file, _args, callback) => callback(null),
      commandExists: async (command) => command === 'xdotool',
      schedule: (callback) => { restore = callback; },
    });
    await service.paste('dictated');
    clipboard.writeText('new user copy');
    restore?.();
    expect(clipboard.current()).toBe('new user copy');
  });

  it('keeps the transcript in the clipboard when Linux paste helpers are absent', async () => {
    const clipboard = fakeClipboard();
    const service = new SystemDictationService({
      platform: 'linux',
      env: {},
      clipboard,
      commandExists: async () => false,
    });
    await expect(service.paste('texte local')).resolves.toMatchObject({
      ok: true,
      copied: true,
      pasted: false,
      mechanism: 'clipboard',
      error: expect.stringContaining('wtype'),
    });
    expect(clipboard.current()).toBe('texte local');
  });
});
