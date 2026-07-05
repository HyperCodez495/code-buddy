import { describe, expect, it } from 'vitest';

import { draftDocOutline, estimateReadingTime } from '../src/renderer/utils/doc-outline';

describe('draftDocOutline', () => {
  it('creates a structured long-form outline', () => {
    const outline = draftDocOutline('Stratégie agentique pour Cowork');

    expect(outline).toHaveLength(5);
    expect(outline[0]?.title).toBe('Résumé exécutif');
    expect(outline[0]?.summary).toContain('Stratégie agentique pour Cowork');
  });

  it('uses a fallback topic for blank prompts', () => {
    expect(draftDocOutline('')[0]?.summary).toContain('Document sans titre');
  });
});

describe('estimateReadingTime', () => {
  it('uses estimated words when present', () => {
    expect(estimateReadingTime([{ id: 'a', title: 'A', summary: 'short', estimatedWords: 221 }])).toBe(2);
  });

  it('falls back to summary word count', () => {
    expect(estimateReadingTime([{ id: 'a', title: 'A', summary: 'one two three four five' }])).toBe(1);
  });
});
