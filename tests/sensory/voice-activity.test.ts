import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginSpeaking,
  endSpeaking,
  isSpeaking,
  withSpeakingGuard,
  _resetVoiceActivityForTests,
} from '../../src/sensory/voice-activity.js';

/**
 * Half-duplex guard: the companion must ignore its own microphone while it is
 * speaking (greeting/reply) — otherwise the ear transcribes the speaker output and
 * the robot answers itself in a loop while dropping the human's real speech.
 */
describe('voice-activity — half-duplex speaking guard', () => {
  beforeEach(() => _resetVoiceActivityForTests());

  it('is not speaking by default', () => {
    expect(isSpeaking(1000)).toBe(false);
  });

  it('is speaking during a play, and through the echo tail afterwards', async () => {
    let speakingInside = false;
    await withSpeakingGuard(async () => {
      speakingInside = isSpeaking();
    });
    const end = Date.now();
    expect(speakingInside).toBe(true); // speaking while the play runs
    expect(isSpeaking(end + 100)).toBe(true); // within the echo tail
    expect(isSpeaking(end + 60_000)).toBe(false); // well past the tail
  });

  it('stays speaking until the LAST concurrent play ends, then arms the tail', () => {
    beginSpeaking();
    beginSpeaking();
    expect(isSpeaking(1000)).toBe(true);
    endSpeaking(1000);
    expect(isSpeaking(1000)).toBe(true); // one play still active
    endSpeaking(1000);
    expect(isSpeaking(1100)).toBe(true); // within tail after the last
    expect(isSpeaking(1000 + 60_000)).toBe(false); // past tail
  });
});
