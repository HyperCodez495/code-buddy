/**
 * Phase 5 of the interactions refonte: the companion conductor — one arbiter so the arrival greeting,
 * presence moments and proactive rituals take turns instead of all speaking in the same minute.
 * Reminders (health safety) always win and reset the floor. Deterministic via an injected clock.
 */
import { describe, it, expect } from 'vitest';
import { CompanionConductor } from '../../src/companion/orchestrator.js';

describe('CompanionConductor — one voice per window', () => {
  it('grants the first claim, denies a second within the gap, allows again after it', () => {
    let t = 1_000_000;
    const c = new CompanionConductor(45_000, () => t);
    expect(c.claim('presence')).toBe(true);
    t += 10_000;
    expect(c.claim('proactive')).toBe(false); // within 45s → floor taken (across surfaces)
    t += 40_000; // now 50s since the grant
    expect(c.claim('arrival')).toBe(true);
  });

  it('shares the floor across all non-reminder surfaces', () => {
    let t = 0;
    const c = new CompanionConductor(60_000, () => t);
    expect(c.claim('arrival')).toBe(true);
    t += 5_000;
    expect(c.claim('presence')).toBe(false);
    t += 5_000;
    expect(c.claim('proactive')).toBe(false);
  });

  it('reminders always speak and reset the floor (safety-critical)', () => {
    let t = 0;
    const c = new CompanionConductor(45_000, () => t);
    expect(c.claim('presence')).toBe(true);
    t += 1_000;
    expect(c.claim('reminder')).toBe(true); // exempt — a dose reminder is never suppressed
    t += 1_000;
    // The reminder reset the floor, so a chatty moment right after is still suppressed.
    expect(c.claim('proactive')).toBe(false);
  });
});
