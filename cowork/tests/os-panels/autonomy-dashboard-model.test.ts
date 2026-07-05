import { describe, expect, it } from 'vitest';
import { clampPercent, formatUsd, summarizeAutonomy, toneForPercent } from '../../src/renderer/components/os-panels/autonomy-dashboard-model.js';

describe('autonomy model', () => {
  it('formats gauges and posture summary', () => {
    const summary = summarizeAutonomy({ posture: 'dontAsk', running: 2, queued: 3, costUsd: 7, capUsd: 10, turns: 9, maxTurns: 10 });

    expect(summary.postureLabel).toBe('Autonomie guidée');
    expect(summary.postureTone).toBe('warning');
    expect(summary.gauges.map((gauge) => gauge.percent)).toEqual([70, 90]);
    expect(summary.isOverCap).toBe(false);
  });

  it('clamps invalid percentages and formats usd', () => {
    expect(clampPercent(15, 10)).toBe(100);
    expect(clampPercent(1, 0)).toBe(0);
    expect(formatUsd(1.2)).toBe('$1.20');
    expect(toneForPercent(95)).toBe('danger');
  });
});
