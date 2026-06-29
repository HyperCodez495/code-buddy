import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasVoiceOutputSupport, interruptSpeech } from '../src/renderer/components/VoiceOutputToggle';

describe('voice playback interruption', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cancels browser speech and records barge-in interruptions', () => {
    const cancel = vi.fn();
    const dispatchEvent = vi.fn();
    const recordInterruption = vi.fn(async () => ({ ok: true }));

    vi.stubGlobal('window', {
      speechSynthesis: {
        speaking: true,
        pending: false,
        cancel,
      },
      dispatchEvent,
      electronAPI: {
        voice: { recordInterruption },
      },
    });

    const interrupted = interruptSpeech('barge_in');

    expect(interrupted).toBe(true);
    expect(cancel).toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'cowork:voice-interrupted',
    }));
    expect(recordInterruption).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'barge_in',
      hadPlayback: true,
    }));
  });

  it('does not audit a new-speech cleanup when nothing was playing', () => {
    const cancel = vi.fn();
    const dispatchEvent = vi.fn();
    const recordInterruption = vi.fn(async () => ({ ok: true }));

    vi.stubGlobal('window', {
      speechSynthesis: {
        speaking: false,
        pending: false,
        cancel,
      },
      dispatchEvent,
      electronAPI: {
        voice: { recordInterruption },
      },
    });

    const interrupted = interruptSpeech('new_speech');

    expect(interrupted).toBe(false);
    expect(cancel).toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalled();
    expect(recordInterruption).not.toHaveBeenCalled();
  });

  it('treats the Piper IPC bridge as voice output support without browser speechSynthesis', () => {
    vi.stubGlobal('window', {
      electronAPI: {
        voice: { speak: vi.fn() },
      },
    });

    expect(hasVoiceOutputSupport()).toBe(true);
  });
});
