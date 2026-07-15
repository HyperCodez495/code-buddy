import { describe, expect, it } from 'vitest';

import { assessAudioScene } from '../../src/sensory/audio-scene.js';

describe('assessAudioScene', () => {
  it('identifies loudspeaker feedback before semantic intent', () => {
    expect(assessAudioScene({
      transcript: 'phrase entendue',
      playbackCaptureKind: 'echo_tail',
      echoClassification: 'echo',
    })).toMatchObject({ scene: 'assistant_playback', confidence: 0.99, wordCount: 2 });
  });

  it('classifies accepted directed turns as nearby speech', () => {
    const scene = assessAudioScene({
      transcript: 'Lisa peux tu regarder ceci',
      decisionReason: 'addressed',
      turnDetector: 'smart-turn-v3',
      aecActive: true,
    });
    expect(scene).toMatchObject({ scene: 'near_speech', confidence: 0.9, aecActive: true });
    expect(scene).not.toHaveProperty('transcript');
  });

  it('uses sustained ambient evidence for broadcasts', () => {
    const scene = assessAudioScene({
      transcript: 'une longue phrase de télévision qui continue sans jamais interpeller directement Lisa dans la pièce',
      decisionReason: 'ambient-burst',
      speakerCount: 2,
    });
    expect(scene.scene).toBe('broadcast');
    expect(scene.confidence).toBeGreaterThan(0.8);
  });
});
