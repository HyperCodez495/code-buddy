import { describe, expect, it } from 'vitest';

import { diffSummary, type DeliverableVersion } from '../src/renderer/utils/version-model';

const base: DeliverableVersion = {
  id: 'v1',
  label: 'v1',
  createdAt: 1,
  author: 'agent',
  summary: 'base',
  entries: { 'a.md': '1', 'b.md': '1' },
};

describe('diffSummary', () => {
  it('counts added, removed and changed entries', () => {
    expect(
      diffSummary(base, {
        ...base,
        id: 'v2',
        entries: { 'a.md': '2', 'c.md': '1' },
      })
    ).toEqual({ added: 1, removed: 1, changed: 1 });
  });

  it('returns zeros for identical versions', () => {
    expect(diffSummary(base, { ...base, id: 'copy' })).toEqual({ added: 0, removed: 0, changed: 0 });
  });
});
