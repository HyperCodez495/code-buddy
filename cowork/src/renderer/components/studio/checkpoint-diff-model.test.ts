import { describe, expect, it } from 'vitest';

import { sortDiff, summarizeDiff, type DiffFileEntry } from './checkpoint-diff-model';

describe('checkpoint diff model', () => {
  it('summarizes statuses and line counters', () => {
    const entries: DiffFileEntry[] = [
      { path: 'src/new.ts', status: 'added', additions: 8 },
      { path: 'src/edit.ts', status: 'modified', additions: 3, deletions: 2 },
      { path: 'src/old.ts', status: 'deleted', deletions: 5 },
      { path: 'src/other.ts', status: 'modified' },
    ];

    expect(summarizeDiff(entries)).toEqual({
      added: 1,
      modified: 2,
      deleted: 1,
      additions: 11,
      deletions: 7,
    });
  });

  it('sorts by status then path', () => {
    const entries: DiffFileEntry[] = [
      { path: 'z-deleted.ts', status: 'deleted' },
      { path: 'b-added.ts', status: 'added' },
      { path: 'b-modified.ts', status: 'modified' },
      { path: 'a-added.ts', status: 'added' },
      { path: 'a-modified.ts', status: 'modified' },
    ];

    expect(sortDiff(entries).map((entry) => `${entry.status}:${entry.path}`)).toEqual([
      'added:a-added.ts',
      'added:b-added.ts',
      'modified:a-modified.ts',
      'modified:b-modified.ts',
      'deleted:z-deleted.ts',
    ]);
  });

  it('handles empty entries', () => {
    expect(summarizeDiff([])).toEqual({ added: 0, modified: 0, deleted: 0, additions: 0, deletions: 0 });
    expect(sortDiff([])).toEqual([]);
  });
});
