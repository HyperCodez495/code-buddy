import { describe, expect, it } from 'vitest';

import { scoreSpread, shouldQuoteMinority, winnerOf, type CouncilVerdict } from '../src/renderer/components/os/util/council-model.js';

const verdicts: CouncilVerdict[] = [
  { agentId: 'a', model: 'gpt', label: 'A', score: 0.8, stance: 'approve' },
  { agentId: 'b', model: 'claude', label: 'B', score: 0.4, stance: 'revise' },
];

describe('council-model', () => {
  it('computes score spread and winner', () => {
    expect(scoreSpread(verdicts)).toBeCloseTo(0.4);
    expect(winnerOf(verdicts)?.agentId).toBe('a');
  });

  it('quotes minority only for strong disagreement', () => {
    expect(shouldQuoteMinority(0.31)).toBe(true);
    expect(shouldQuoteMinority(0.3)).toBe(false);
  });
});
