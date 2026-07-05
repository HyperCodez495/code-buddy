import { describe, expect, it } from 'vitest';

import { partitionByRisk, riskLevel } from '../src/renderer/components/os-actions/utils/approval-queue-model.js';

describe('approval-queue-model', () => {
  it('maps numeric scores to risk buckets', () => {
    expect(riskLevel(12)).toBe('low');
    expect(riskLevel(55)).toBe('medium');
    expect(riskLevel(80)).toBe('high');
    expect(riskLevel(95)).toBe('critical');
  });

  it('partitions approval requests by risk', () => {
    const groups = partitionByRisk([
      { id: 'a', action: 'read', riskScore: 10, summary: 'safe' },
      { id: 'b', action: 'deploy', riskScore: 92, summary: 'prod' },
    ]);
    expect(groups.low).toHaveLength(1);
    expect(groups.critical[0]?.id).toBe('b');
  });
});
