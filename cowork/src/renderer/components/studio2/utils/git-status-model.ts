export interface GitChange { path: string; status: string; }
export interface PartitionedChanges { staged: GitChange[]; modified: GitChange[]; untracked: GitChange[]; }
export function partitionChanges(changes: GitChange[]): PartitionedChanges {
  return changes.reduce((groups: PartitionedChanges, change) => { const first = change.status[0] ?? ''; const second = change.status[1] ?? ''; if (change.status === '??') groups.untracked.push(change); else if (first.trim()) groups.staged.push(change); else if (second.trim() || change.status) groups.modified.push(change); return groups; }, { staged: [], modified: [], untracked: [] });
}
export function canCommit(message: string, changes: GitChange[]): boolean { return message.trim().length > 0 && changes.length > 0; }
