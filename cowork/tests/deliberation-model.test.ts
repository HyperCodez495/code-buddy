import { describe, expect, it } from 'vitest';

import { scoreSpread, shouldQuoteMinority } from '../src/renderer/utils/deliberation-model';

describe('scoreSpread', () => {
  it('computes max minus min score', () => {
    expect(
      scoreSpread([
        { id: 'a', model: 'A', score: 0.2, position: 'oppose', reason: '' },
        { id: 'b', model: 'B', score: 0.9, position: 'support', reason: '' },
      ])
    ).toBeCloseTo(0.7);
  });

  it('returns zero for no verdicts', () => {
    expect(scoreSpread([])).toBe(0);
  });
});

describe('shouldQuoteMinority', () => {
  it('quotes only when spread is above the threshold', () => {
    expect(shouldQuoteMinority(0.31)).toBe(true);
    expect(shouldQuoteMinority(0.3)).toBe(false);
  });
});
