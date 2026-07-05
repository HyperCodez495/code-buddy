import { describe, expect, it } from 'vitest';

import { ackableWithin, sortBySeverity } from '../src/renderer/components/os-actions/utils/alert-model.js';

describe('alert-model', () => {
  it('sorts critical alerts first and older equal-severity alerts first', () => {
    expect(sortBySeverity([
      { id: 'w', severity: 'warning', createdAt: 2 },
      { id: 'c', severity: 'critical', createdAt: 3 },
      { id: 'i', severity: 'info', createdAt: 1 },
      { id: 'w-old', severity: 'warning', createdAt: 1 },
    ]).map((alert) => alert.id)).toEqual(['c', 'w-old', 'w', 'i']);
  });

  it('checks acknowledgement windows', () => {
    expect(ackableWithin({ id: 'a', severity: 'info', createdAt: 0, ackDeadlineAt: 10 }, 9)).toBe(true);
    expect(ackableWithin({ id: 'a', severity: 'info', createdAt: 0, ackDeadlineAt: 10 }, 11)).toBe(false);
  });
});
