import { describe, expect, it } from 'vitest';

import { draftPodcastScript, estimateAudioLength } from '../src/renderer/utils/podcast-script';

describe('draftPodcastScript', () => {
  it('creates a narrated script from a topic', () => {
    const segments = draftPodcastScript('les agents IA locaux');

    expect(segments).toHaveLength(4);
    expect(segments[0]?.script).toContain('les agents IA locaux');
    expect(segments.every((segment) => segment.voice.length > 0)).toBe(true);
  });

  it('uses a fallback topic', () => {
    expect(draftPodcastScript('')[0]?.script).toContain('Sujet à définir');
  });
});

describe('estimateAudioLength', () => {
  it('estimates narration length in seconds', () => {
    expect(estimateAudioLength([{ id: 'a', title: 'A', voice: 'V', script: 'one two three four five' }])).toBe(2);
  });

  it('returns zero for empty scripts', () => {
    expect(estimateAudioLength([{ id: 'a', title: 'A', voice: 'V', script: '' }])).toBe(0);
  });
});
