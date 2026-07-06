export interface DiffFileEntry {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions?: number;
  deletions?: number;
}

export interface DiffSummary {
  added: number;
  modified: number;
  deleted: number;
  additions: number;
  deletions: number;
}

const STATUS_ORDER: Record<DiffFileEntry['status'], number> = {
  added: 0,
  modified: 1,
  deleted: 2,
};

export function summarizeDiff(entries: readonly DiffFileEntry[]): DiffSummary {
  return entries.reduce<DiffSummary>(
    (summary, entry) => {
      summary[entry.status] += 1;
      summary.additions += entry.additions ?? 0;
      summary.deletions += entry.deletions ?? 0;
      return summary;
    },
    { added: 0, modified: 0, deleted: 0, additions: 0, deletions: 0 },
  );
}

export function sortDiff(entries: readonly DiffFileEntry[]): DiffFileEntry[] {
  return [...entries].sort((a, b) => {
    const statusDelta = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (statusDelta !== 0) return statusDelta;
    return a.path.localeCompare(b.path);
  });
}
