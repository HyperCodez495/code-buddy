import { describe, expect, it } from 'vitest';

import { riskLevel } from '../src/renderer/utils/approval-model';

describe('riskLevel', () => {
  it('flags destructive requests as high risk', () => {
    expect(riskLevel({ id: 'a', action: 'Delete', diffSummary: '', riskFactors: [], destructive: true })).toBe('high');
  });

  it('flags risk factors as medium risk', () => {
    expect(riskLevel({ id: 'a', action: 'Edit', diffSummary: '', riskFactors: ['writes files'] })).toBe('medium');
  });

  it('keeps simple requests low risk', () => {
    expect(riskLevel({ id: 'a', action: 'Read', diffSummary: '', riskFactors: [] })).toBe('low');
  });
});
