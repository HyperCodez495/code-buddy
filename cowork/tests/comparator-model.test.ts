import { describe, expect, it } from 'vitest';

import { agreementRate, rankAnswers, type ModelAnswer } from '../src/renderer/utils/comparator-model';

const answers: ModelAnswer[] = [
  { id: 'a', model: 'B', answer: 'b', score: 0.7, stance: 'agree' },
  { id: 'b', model: 'A', answer: 'a', score: 0.9, stance: 'disagree' },
  { id: 'c', model: 'C', answer: 'c', score: 0.4, stance: 'abstain' },
];

describe('rankAnswers', () => {
  it('sorts by score descending', () => {
    expect(rankAnswers(answers).map((answer) => answer.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('agreementRate', () => {
  it('ignores abstentions and returns the agree ratio', () => {
    expect(agreementRate(answers)).toBe(0.5);
  });

  it('returns zero without decisive answers', () => {
    expect(agreementRate([{ id: 'x', model: 'X', answer: '', score: 0, stance: 'abstain' }])).toBe(0);
  });
});
