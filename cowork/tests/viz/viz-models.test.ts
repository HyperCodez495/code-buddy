/**
 * viz util models — real tests (no mocks): donut, stacked bar, timeline, heatmap
 * pure geometry/normalisation.
 */
import { describe, expect, it } from 'vitest';
import { percentages, toArcs } from '../../src/renderer/components/viz/util/donut-model';
import { totalValue, stackParts } from '../../src/renderer/components/viz/util/stacked-model';
import { timeRange, layoutEvents } from '../../src/renderer/components/viz/util/timeline-model';
import { normalizeCells, colorFor } from '../../src/renderer/components/viz/util/heat-model';

describe('donut-model', () => {
  it('percentages sum to 100 and zero-out an empty/all-zero series', () => {
    const p = percentages([{ label: 'a', value: 1 }, { label: 'b', value: 1 }, { label: 'c', value: 2 }]);
    // percentages returns fractions of the whole (they sum to 1).
    expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1);
    expect(p[2]).toBeGreaterThan(p[0]!);
    expect(percentages([{ label: 'z', value: 0 }])).toEqual([0]);
  });

  it('toArcs yields one arc per segment with a path', () => {
    const arcs = toArcs([{ label: 'a', value: 3 }, { label: 'b', value: 1 }]);
    expect(arcs).toHaveLength(2);
    for (const arc of arcs) expect(typeof arc.path).toBe('string');
  });
});

describe('stacked-model', () => {
  it('totalValue sums positives, stackParts widths cover the bar', () => {
    expect(totalValue([{ label: 'a', value: 3, tone: 'primary' }, { label: 'b', value: 2, tone: 'success' }])).toBe(5);
    const segs = stackParts([{ label: 'a', value: 3, tone: 'primary' }, { label: 'b', value: 1, tone: 'success' }]);
    expect(Math.round(segs.reduce((s, x) => s + x.widthPct, 0))).toBe(100);
    expect(segs[0]!.startPct).toBe(0);
  });
});

describe('timeline-model', () => {
  it('timeRange spans first to last, layoutEvents places xPct in [0,100]', () => {
    const r = timeRange([{ t: 10, label: 'a' }, { t: 30, label: 'b' }]);
    expect(r.start).toBe(10);
    expect(r.end).toBe(30);
    expect(r.span).toBe(20);
    const laid = layoutEvents([{ t: 10, label: 'a' }, { t: 20, label: 'b' }, { t: 30, label: 'c' }]);
    for (const e of laid) {
      expect(e.xPct).toBeGreaterThanOrEqual(0);
      expect(e.xPct).toBeLessThanOrEqual(100);
    }
  });
});

describe('heat-model', () => {
  it('normalizeCells maps into [0,1] and colorFor returns a valid tone', () => {
    const norm = normalizeCells([[0, 10], [5, 5]]);
    for (const row of norm) for (const v of row) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    for (const tone of [colorFor(0), colorFor(0.5), colorFor(1)]) {
      expect(['empty', 'low', 'medium', 'high']).toContain(tone);
    }
  });
});
