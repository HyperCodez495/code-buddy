import { describe, expect, it } from 'vitest';

import { draftStoryboard, totalDuration } from '../src/renderer/utils/storyboard-model';

describe('draftStoryboard', () => {
  it('turns sentences into scenes', () => {
    const scenes = draftStoryboard('Accroche forte. Démonstration produit. Appel à action.');

    expect(scenes).toHaveLength(3);
    expect(scenes[0]?.title).toBe('Hook');
    expect(scenes[2]?.title).toBe('Conclusion');
  });

  it('uses a fallback storyboard for empty text', () => {
    expect(draftStoryboard('')).toHaveLength(3);
  });
});

describe('totalDuration', () => {
  it('sums positive scene durations', () => {
    expect(totalDuration([{ id: 's', title: 'S', visual: 'V', voiceover: 'O', durationSec: 5 }])).toBe(5);
  });

  it('ignores negative scene durations', () => {
    expect(totalDuration([{ id: 's', title: 'S', visual: 'V', voiceover: 'O', durationSec: -5 }])).toBe(0);
  });
});
