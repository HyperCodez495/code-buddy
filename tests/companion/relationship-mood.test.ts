/**
 * Phase 1 of the interactions refonte: Lisa's numeric inner state (mood + drifting traits + rapport
 * tier). These are the pure, deterministic building blocks the later phases colour her voice with.
 *
 * The load-bearing property is ANTI-RATCHET: a signal nudges a value, but each step also decays
 * toward a baseline, so a burst fades once it stops — the state drifts, it never accumulates
 * without bound. We prove that directly (not with a mock) by iterating the real function.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TRAITS,
  MOOD_BASELINE,
  evolveTraits,
  personalityOf,
  recordReunion,
  moodBand,
  rapportTier,
  getPersonalitySummary,
  type RelationshipState,
  type RelationalSignal,
} from '../../src/companion/relationship-state.js';

function fresh(): RelationshipState {
  return { celebratedMilestones: [] };
}

describe('personalityOf — defaults + clamping', () => {
  it('fills baselines for an old/empty state', () => {
    const p = personalityOf(fresh());
    expect(p.mood).toBe(MOOD_BASELINE);
    expect(p.traits).toEqual(DEFAULT_TRAITS);
    expect(p.sessions).toBe(0);
  });

  it('clamps out-of-range persisted values into [0,100]', () => {
    const p = personalityOf({ celebratedMilestones: [], mood: 999, traits: { warmth: -40 }, sessions: -3 });
    expect(p.mood).toBe(100);
    expect(p.traits.warmth).toBe(0);
    expect(p.traits.humor).toBe(DEFAULT_TRAITS.humor); // missing trait → baseline
    expect(p.sessions).toBe(0);
  });
});

describe('evolveTraits — direction, bounds, anti-ratchet', () => {
  it('moves the relevant trait in the right direction', () => {
    const base = personalityOf(fresh());
    expect(personalityOf(evolveTraits(fresh(), 'joking')).traits.humor).toBeGreaterThan(base.traits.humor);
    expect(personalityOf(evolveTraits(fresh(), 'deep-talk')).traits.depth).toBeGreaterThan(base.traits.depth);
    expect(personalityOf(evolveTraits(fresh(), 'affection')).traits.warmth).toBeGreaterThan(base.traits.warmth);
  });

  it('frustration dips the mood (she softens, feels the strain with him)', () => {
    expect(personalityOf(evolveTraits(fresh(), 'frustration')).mood).toBeLessThan(MOOD_BASELINE);
  });

  it('a raised trait decays back toward baseline under neutral signals (NO ratchet)', () => {
    // Push humor up, then let it sit through neutral interactions.
    let s = fresh();
    for (let i = 0; i < 8; i++) s = evolveTraits(s, 'joking');
    const peak = personalityOf(s).traits.humor;
    expect(peak).toBeGreaterThan(DEFAULT_TRAITS.humor);

    let prev = peak;
    for (let i = 0; i < 20; i++) {
      s = evolveTraits(s, 'neutral');
      const now = personalityOf(s).traits.humor;
      expect(now).toBeLessThanOrEqual(prev + 1e-9); // strictly non-increasing while above baseline
      prev = now;
    }
    // Converged close to baseline — the burst faded.
    expect(Math.abs(personalityOf(s).traits.humor - DEFAULT_TRAITS.humor)).toBeLessThan(5);
  });

  it('stays within [0,100] under relentless one-sided signals', () => {
    const signals: RelationalSignal[] = ['affection', 'joking', 'frustration', 'deep-talk', 'debugging-together'];
    for (const sig of signals) {
      let s = fresh();
      for (let i = 0; i < 200; i++) s = evolveTraits(s, sig);
      const p = personalityOf(s);
      for (const v of [p.mood, p.traits.warmth, p.traits.humor, p.traits.depth, p.traits.energy]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it('does not touch the sessions counter', () => {
    const s = evolveTraits({ celebratedMilestones: [], sessions: 7 }, 'joking');
    expect(personalityOf(s).sessions).toBe(7);
  });
});

describe('recordReunion', () => {
  it('increments sessions by one', () => {
    expect(personalityOf(recordReunion(fresh())).sessions).toBe(1);
    expect(personalityOf(recordReunion({ celebratedMilestones: [], sessions: 4 })).sessions).toBe(5);
  });
});

describe('moodBand', () => {
  it('maps thresholds to bands', () => {
    expect(moodBand(95)).toBe('radieuse');
    expect(moodBand(70)).toBe('joyeuse');
    expect(moodBand(60)).toBe('sereine');
    expect(moodBand(30)).toBe('songeuse');
    expect(moodBand(10)).toBe('lasse');
  });
  it('clamps before banding', () => {
    expect(moodBand(-100)).toBe('lasse');
    expect(moodBand(9999)).toBe('radieuse');
  });
});

describe('rapportTier — non-gamified familiarity from reunion count', () => {
  it('deepens across sparse thresholds', () => {
    expect(rapportTier(0)).toBe('nouveau');
    expect(rapportTier(4)).toBe('nouveau');
    expect(rapportTier(5)).toBe('familier');
    expect(rapportTier(20)).toBe('complice');
    expect(rapportTier(60)).toBe('vieil ami');
  });
});

describe('getPersonalitySummary', () => {
  it('is exactly two lines and names mood band, rapport, and dominant traits', () => {
    const summary = getPersonalitySummary({ celebratedMilestones: [], mood: 90, sessions: 25, traits: { warmth: 88, depth: 80, humor: 40, energy: 50 } });
    const lines = summary.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('radieuse');
    expect(lines[0]).toContain('complice');
    // Two dominant traits are warmth (88) + depth (80).
    expect(lines[1]).toContain('chaleur');
    expect(lines[1]).toContain('profondeur');
    expect(lines[1]).not.toContain('humour'); // 40 is not dominant
  });
});
