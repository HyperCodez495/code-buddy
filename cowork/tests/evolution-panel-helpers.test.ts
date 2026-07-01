import { describe, expect, it } from 'vitest';
import { groupByGeneration, variantGeneration, isWinner, type EvolvedVariant } from '../src/renderer/components/evolution-panel-helpers';

function v(over: Partial<EvolvedVariant>): EvolvedVariant {
  return { id: 'v', branch: 'b', sha: 's', score: 0.5, passedAll: true, regressions: [], createdAt: '2026-07-01T00:00:00.000Z', ...over };
}

describe('evolution-panel-helpers', () => {
  it('variantGeneration defaults missing to 0', () => {
    expect(variantGeneration(v({}))).toBe(0);
    expect(variantGeneration(v({ generation: 3 }))).toBe(3);
  });

  it('groupByGeneration bands by generation asc, score desc within a band', () => {
    const groups = groupByGeneration([
      v({ id: 'g1-lo', generation: 1, score: 0.6 }),
      v({ id: 'g0', generation: 0, score: 0.5 }),
      v({ id: 'g1-hi', generation: 1, score: 0.9 }),
    ]);
    expect(groups.map((g) => g.generation)).toEqual([0, 1]);
    expect(groups[1]!.variants.map((x) => x.id)).toEqual(['g1-hi', 'g1-lo']);
  });

  it('isWinner = passed + no regression', () => {
    expect(isWinner(v({ passedAll: true, regressions: [] }))).toBe(true);
    expect(isWinner(v({ passedAll: false }))).toBe(false);
    expect(isWinner(v({ regressions: ['unit'] }))).toBe(false);
  });

  it('empty → no groups', () => {
    expect(groupByGeneration([])).toEqual([]);
  });
});
