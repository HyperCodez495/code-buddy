import { describe, expect, it } from 'vitest';

import { estimatePlan, formatCost, formatEstimateDuration, type PlanStep } from '../src/renderer/utils/dryrun-estimate';

describe('estimatePlan', () => {
  it('sums tokens, cost and time across plan steps', () => {
    const steps: PlanStep[] = [
      { id: 'a', title: 'Search', tool: 'deep_research', inputTokens: 1000, outputTokens: 400, costUsd: 0.012, durationMs: 20_000 },
      { id: 'b', title: 'Patch', tool: 'code_edit', inputTokens: 300, outputTokens: 700, costUsd: 0.021, durationMs: 35_000 },
    ];

    expect(estimatePlan(steps)).toEqual({
      inputTokens: 1300,
      outputTokens: 1100,
      totalTokens: 2400,
      costUsd: 0.033,
      durationMs: 55_000,
    });
  });

  it('ignores invalid negative values', () => {
    expect(
      estimatePlan([{ id: 'a', title: 'Bad', tool: 'noop', inputTokens: -10, outputTokens: Number.NaN, costUsd: -1, durationMs: -5 }])
    ).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      durationMs: 0,
    });
  });
});

describe('formatCost', () => {
  it('formats zero, sub-cent and normal estimates', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.0042)).toBe('$0.0042');
    expect(formatCost(1.235)).toBe('$1.24');
  });
});

describe('formatEstimateDuration', () => {
  it('rounds durations up for user-facing estimates', () => {
    expect(formatEstimateDuration(250)).toBe('1s');
    expect(formatEstimateDuration(60_000)).toBe('1m');
    expect(formatEstimateDuration(65_100)).toBe('1m 6s');
  });
});
