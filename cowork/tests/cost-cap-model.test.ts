import { describe, expect, it } from 'vitest';

import { capTone, projectedPercent, projectOverrun } from '../src/renderer/components/os-actions/utils/cost-cap-model.js';

describe('cost-cap-model', () => {
  it('computes projected overrun', () => {
    expect(projectOverrun({ currentUsd: 4, projectedUsd: 12, capUsd: 10 })).toBe(2);
    expect(projectOverrun({ currentUsd: 4, projectedUsd: 8, capUsd: 10 })).toBe(0);
  });

  it('assigns tones from projection ratio', () => {
    expect(capTone({ currentUsd: 1, projectedUsd: 7, capUsd: 10 })).toBe('safe');
    expect(capTone({ currentUsd: 1, projectedUsd: 8, capUsd: 10 })).toBe('warning');
    expect(capTone({ currentUsd: 1, projectedUsd: 10, capUsd: 10 })).toBe('danger');
  });

  it('formats projected percent', () => {
    expect(projectedPercent({ currentUsd: 0, projectedUsd: 2.5, capUsd: 10 })).toBe(25);
  });
});
