import { describe, expect, it } from 'vitest';

import { canAssignRole, normalizeAllowlist, normalizeCapacity } from '../src/renderer/components/os-actions/utils/peer-control-model.js';

describe('peer-control-model', () => {
  it('normalizes capacity into percentage bounds', () => {
    expect(normalizeCapacity(150.4)).toBe(100);
    expect(normalizeCapacity(-1)).toBe(0);
  });

  it('guards coordinator role by capacity', () => {
    expect(canAssignRole('coordinator', 49)).toBe(false);
    expect(canAssignRole('coordinator', 50)).toBe(true);
  });

  it('deduplicates allowlists', () => {
    expect(normalizeAllowlist(['search', ' view_file ', 'search', ''])).toEqual(['search', 'view_file']);
  });
});
