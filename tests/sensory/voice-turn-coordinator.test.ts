import { describe, expect, it } from 'vitest';

import { VoiceTurnCoordinator } from '../../src/sensory/voice-turn-coordinator.js';

describe('VoiceTurnCoordinator', () => {
  it('correlates a full turn and persists no raw speech', () => {
    let now = 1_700_000_000_000;
    const coordinator = new VoiceTurnCoordinator({ persist: false, now: () => now++ });

    coordinator.transition('voice_1', 'listening', { aecActive: true });
    coordinator.transition('voice_1', 'transcribing', { captureMs: 734 });
    coordinator.transition('voice_1', 'deciding', {
      decisionReason: 'addressed',
      wordCount: 8,
    });
    coordinator.transition('voice_1', 'thinking');
    coordinator.transition('voice_1', 'speaking', { firstAudioMs: 420 });
    const snapshot = coordinator.transition('voice_1', 'completed', {
      spoke: true,
      totalMs: 1_480,
    });

    expect(snapshot.phase).toBe('completed');
    expect(snapshot.activeTurnId).toBeUndefined();
    expect(snapshot.counters).toEqual({
      captured: 1,
      accepted: 1,
      spoken: 1,
      suppressed: 0,
      interrupted: 0,
      failed: 0,
    });
    expect(JSON.stringify(snapshot)).not.toContain('raw speech');
  });

  it('bounds history and sanitizes free-form reasons', () => {
    const coordinator = new VoiceTurnCoordinator({ persist: false, maxRecent: 8 });
    for (let index = 0; index < 12; index++) {
      coordinator.transition(`turn_${index}`, 'suppressed', {
        suppressionReason: 'Echo from speakers: secret sentence',
      });
    }
    const snapshot = coordinator.snapshot();
    expect(snapshot.recent).toHaveLength(8);
    expect(snapshot.recent.at(-1)?.suppressionReason).toBe(
      'echo-from-speakers-secret-sentence',
    );
    expect(snapshot.counters.suppressed).toBe(12);
  });

  it('keeps a newer acoustic turn active when the previous turn finishes', () => {
    const coordinator = new VoiceTurnCoordinator({ persist: false });
    coordinator.transition('turn_1', 'thinking');
    coordinator.transition('turn_2', 'listening');
    const snapshot = coordinator.transition('turn_1', 'completed', { spoke: true });

    expect(snapshot.phase).toBe('listening');
    expect(snapshot.activeTurnId).toBe('turn_2');
  });
});
