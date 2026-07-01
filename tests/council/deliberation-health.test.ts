/**
 * Deliberation Health Index — pure computation, pinned on synthetic cases.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { computeDeliberationHealth, type DeliberationHealthInput } from '../../src/council/deliberation-health.js';

function input(over: Partial<DeliberationHealthInput> = {}): DeliberationHealthInput {
  return {
    at: '2026-07-01T00:00:00.000Z',
    taskType: 'code',
    planMode: 'collective',
    seats: 3,
    answers: [
      { content: 'migrate storage sqlite transactions locking', winner: true },
      { content: 'overengineering native dependency windows lockfile', winner: false },
      { content: 'clarify requirements volume access pattern', winner: false },
    ],
    judgeAlive: true,
    scores: [0.95, 0.25, 0.65],
    consensusScore: 0.11,
    synthesis: 'migrate sqlite transactions — but beware native dependency windows lockfile',
    ...over,
  };
}

describe('computeDeliberationHealth', () => {
  it('computes the components on a healthy deliberation', () => {
    const h = computeDeliberationHealth(input());

    expect(h.seatSurvival).toBe(1);
    expect(h.judgeAlive).toBe(1);
    expect(h.stanceDivergence).toBeCloseTo(0.89, 5);
    expect(h.judgeDiscrimination).toBeCloseTo(0.7, 5);
    // Dissent retention: answer 2's distinctive terms (overengineering, native,
    // dependency, windows, lockfile) largely survive in the synthesis; answer 3's do not.
    expect(h.dissentRetention).toBeGreaterThan(0.3);
    expect(h.anchorRatio).not.toBeNull();
    expect(h.dhi).toBeGreaterThan(0.5);
  });

  it('is zero when the judge is dead — nothing else can compensate', () => {
    const h = computeDeliberationHealth(input({ judgeAlive: false, scores: [0, 0, 0] }));
    expect(h.judgeAlive).toBe(0);
    expect(h.dhi).toBe(0);
  });

  it('is scaled down by a decimated panel', () => {
    const healthy = computeDeliberationHealth(input());
    const decimated = computeDeliberationHealth(
      input({ seats: 3, answers: input().answers.slice(0, 1), synthesis: null, scores: [0.9] }),
    );
    expect(decimated.seatSurvival).toBeCloseTo(1 / 3, 5);
    expect(decimated.dhi).toBeLessThan(healthy.dhi);
  });

  it('drops synthesis-dependent components in direct mode (no synthesis)', () => {
    const h = computeDeliberationHealth(input({ planMode: 'direct', synthesis: null }));
    expect(h.dissentRetention).toBeNull();
    expect(h.anchorRatio).toBeNull();
    expect(h.dhi).toBeGreaterThan(0); // mean over the remaining components
  });

  it('flags winner anchoring: a synthesis that only rewrites the winner scores lower', () => {
    const anchored = computeDeliberationHealth(
      input({
        synthesis: 'migrate storage sqlite transactions locking now',
      }),
    );
    const balanced = computeDeliberationHealth(input());
    expect(anchored.dissentRetention).toBe(0);
    expect(anchored.dhi).toBeLessThan(balanced.dhi);
  });
});
