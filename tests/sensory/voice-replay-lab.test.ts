import { describe, expect, it } from 'vitest';

import {
  replayVoiceTimeline,
  voiceEchoSimilarity,
} from '../../src/sensory/voice-replay-lab.js';

describe('voice replay lab', () => {
  it('detects a delayed acoustic repetition without returning raw text', () => {
    const report = replayVoiceTimeline([
      { role: 'assistant', content: 'Je vais regarder la météo avec toi.', timestamp: 1_000 },
      { role: 'user', content: 'Je vais regarder la météo avec toi', timestamp: 4_500 },
      { role: 'assistant', content: 'Très bien, voici le résultat.', timestamp: 5_000 },
    ]);
    expect(report).toMatchObject({
      safeMode: 'offline-silent',
      echoCandidates: 1,
      delayedEchoCandidates: 1,
      passed: true,
    });
    expect(JSON.stringify(report)).not.toContain('météo');
  });

  it('does not confuse a real reply with loudspeaker echo', () => {
    expect(voiceEchoSimilarity(
      'La météo annonce du soleil demain.',
      'Merci, et quelle température fera-t-il ?',
    )).toBeLessThan(0.5);
  });
});
