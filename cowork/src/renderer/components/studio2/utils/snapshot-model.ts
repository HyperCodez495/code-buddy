export interface ProjectSnapshot { id: string; label: string; createdAt: string; path?: string; }
export function sortSnapshots(snapshots: ProjectSnapshot[]): ProjectSnapshot[] { return [...snapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function canRestore(snapshotId: string | undefined, snapshots: ProjectSnapshot[]): boolean { return Boolean(snapshotId && snapshots.some((snapshot) => snapshot.id === snapshotId)); }
export function nextSnapshotLabel(now = new Date()): string { return 'Snapshot ' + now.toISOString().slice(0, 19).replace('T', ' '); }
