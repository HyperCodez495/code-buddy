/**
 * viz scaling math — real tests (no mocks). This is the shared core behind every
 * hand-rolled chart (Sparkline, etc.), so keep it honest.
 */
import { describe, expect, it } from 'vitest';
import { niceScale, pointsFromValues, pathFromValues } from '../../src/renderer/components/viz/util/scale';

describe('niceScale', () => {
  it('handles empty input with a safe unit scale', () => {
    expect(niceScale([], 32)).toEqual({ min: 0, max: 1, span: 1, height: 32 });
  });

  it('pads a flat series so it does not divide by zero', () => {
    const s = niceScale([5, 5, 5]);
    expect(s.min).toBeLessThan(5);
    expect(s.max).toBeGreaterThan(5);
    expect(s.span).toBeGreaterThan(0);
  });

  it('brackets a real range with padding', () => {
    const s = niceScale([0, 10]);
    expect(s.min).toBeLessThan(0);
    expect(s.max).toBeGreaterThan(10);
    expect(s.span).toBeGreaterThan(10);
  });
});

describe('pointsFromValues', () => {
  it('returns [] for no values', () => {
    expect(pointsFromValues([])).toEqual([]);
  });

  it('spreads points across the width and keeps y within the box', () => {
    const pts = pointsFromValues([1, 5, 3], 120, 32);
    expect(pts).toHaveLength(3);
    expect(pts[0]!.x).toBe(0);
    expect(pts[2]!.x).toBeCloseTo(120);
    for (const p of pts) {
      expect(p.y).toBeGreaterThanOrEqual(-0.01);
      expect(p.y).toBeLessThanOrEqual(32.01);
    }
    // The largest value sits highest (smallest y).
    expect(pts[1]!.y).toBeLessThan(pts[0]!.y);
  });
});

describe('pathFromValues', () => {
  it('builds an SVG path starting with a moveto', () => {
    const d = pathFromValues([1, 2, 3], 120, 32);
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain('L ');
    expect(pathFromValues([])).toBe('');
  });
});
