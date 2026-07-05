import { describe, expect, it } from 'vitest';

import { formatUtilization, saturationLevel } from '../src/renderer/components/os/util/fleet-load-model.js';

describe('fleet-load-model', () => {
  it('detects idle, nominal and saturated fleet load', () => {
    expect(saturationLevel({ queued: 0, running: 0, capacity: 4, backpressure: 0, utilization: 0.1 })).toBe('idle');
    expect(saturationLevel({ queued: 1, running: 2, capacity: 4, backpressure: 0.2, utilization: 0.5 })).toBe('nominal');
    expect(saturationLevel({ queued: 8, running: 4, capacity: 4, backpressure: 0.8, utilization: 0.9 })).toBe('saturated');
  });

  it('formats clamped utilization percentages', () => {
    expect(formatUtilization(0.456)).toBe('46%');
    expect(formatUtilization(2)).toBe('100%');
  });
});
