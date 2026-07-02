import { describe, it, expect } from 'vitest';
import { buildArrivalOpener, pushRecent, ARRIVAL_RING_SIZE, ARRIVAL_TRIGGERS, templatePool } from '../../src/sensory/arrival-opener.js';

// Local 08:00 → morning; constructed + read with local time so it's TZ-stable.
const morningNow = new Date(2026, 5, 30, 8, 0, 0).getTime();
const eveningNow = new Date(2026, 5, 30, 20, 0, 0).getTime();

describe('buildArrivalOpener', () => {
  it('selects trigger from time of day', () => {
    expect(buildArrivalOpener({ now: morningNow }).trigger).toBe('morning');
    expect(buildArrivalOpener({ now: eveningNow }).trigger).toBe('evening');
  });

  it('drowsy state overrides time', () => {
    expect(buildArrivalOpener({ now: morningNow, drowsy: true }).trigger).toBe('drowsy');
  });

  it('a short gap since last seen → backSoon', () => {
    expect(buildArrivalOpener({ now: morningNow, lastSeenAt: morningNow - 1000 }).trigger).toBe('backSoon');
  });

  it('avoids a recently-used template (anti-repetition)', () => {
    const first = buildArrivalOpener({ now: morningNow, rng: () => 0 });
    const second = buildArrivalOpener({ now: morningNow, recent: [first.template], rng: () => 0 });
    expect(second.trigger).toBe('morning');
    expect(second.template).not.toBe(first.template); // skipped the recent one
  });

  it('produces variety across the pool', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) seen.add(buildArrivalOpener({ now: morningNow, rng: () => i / 8 }).template);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('every trigger pool is rich (>= 7 varied lines)', () => {
    for (const trigger of ARRIVAL_TRIGGERS) {
      const pool = templatePool(trigger);
      expect(pool.length, trigger).toBeGreaterThanOrEqual(7);
      expect(new Set(pool).size, `${trigger} has duplicates`).toBe(pool.length);
    }
  });

  it('never repeats the same line twice in a row over a long run (ring maintained)', () => {
    // Deterministic pseudo-rng so the run is reproducible without Math.random.
    let s = 12345;
    const rng = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    let recent: string[] = [];
    let prev = '';
    for (let i = 0; i < 60; i++) {
      const o = buildArrivalOpener({ now: morningNow, recent, rng });
      expect(o.template, `consecutive repeat at ${i}`).not.toBe(prev);
      prev = o.template;
      recent = pushRecent(recent, o.template);
    }
  });

  it('interpolates name, and cleanly drops {{name}} when absent', () => {
    const withName = buildArrivalOpener({ now: morningNow, name: 'Patrice', rng: () => 0 });
    const without = buildArrivalOpener({ now: morningNow, rng: () => 0 });
    expect(withName.text).toContain('Patrice');
    expect(without.text).not.toContain('{{');
    expect(without.text).not.toContain('  '); // no double space left by the dropped token
  });
});

describe('pushRecent', () => {
  it('puts most-recent first, dedups, caps at ring size', () => {
    expect(pushRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
    expect(pushRecent(['a', 'b'], 'a')).toEqual(['a', 'b']); // dedup, moved to front
    const big = Array.from({ length: ARRIVAL_RING_SIZE + 3 }, (_, i) => `t${i}`);
    expect(pushRecent(big, 'new').length).toBe(ARRIVAL_RING_SIZE);
  });
});
