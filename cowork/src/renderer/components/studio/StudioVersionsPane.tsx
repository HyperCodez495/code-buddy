/**
 * StudioVersionsPane — container wiring the presentational CheckpointTimeline
 * (vague Codex C) onto the REAL ghost-snapshot engine: checkpoint.list feeds
 * the timeline, restore goes through checkpoint.restore (ghost snapshots are
 * undo/redo-able, so a restore is never destructive), and « Diff » (vague
 * Codex D) compares the snapshot's git commit against HEAD through
 * checkpoint.compare. The caller refreshes the file tree after a restore.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { CheckpointTimeline } from './CheckpointTimeline';
import type { CheckpointEntry } from './checkpoint-timeline-model';
import { CheckpointDiffView } from './CheckpointDiffView';
import { sortDiff, type DiffFileEntry } from './checkpoint-diff-model';

interface GhostSnapshotWire {
  id: string;
  commitHash?: string;
  description?: string;
  timestamp?: string | Date;
  turn?: number;
}

export function StudioVersionsPane({ cwd, onRestored }: { cwd?: string; onRestored?: () => void }) {
  const [entries, setEntries] = useState<CheckpointEntry[] | null>(null);
  const [diffEntries, setDiffEntries] = useState<DiffFileEntry[] | null>(null);
  const commitsRef = useRef(new Map<string, string>());

  const refresh = useCallback(() => {
    void window.electronAPI?.checkpoint
      ?.list()
      .then((raw: unknown) => {
        const timeline = raw as { snapshots?: GhostSnapshotWire[] } | null;
        const snapshots = timeline?.snapshots ?? [];
        commitsRef.current = new Map(
          snapshots.filter((snap) => snap.commitHash).map((snap) => [snap.id, snap.commitHash!]),
        );
        setEntries(
          snapshots.map((snap) => ({
            id: snap.id,
            label: snap.turn !== undefined ? `Tour ${snap.turn} — ${snap.description ?? snap.id}` : (snap.description ?? snap.id),
            createdAt: snap.timestamp ? new Date(snap.timestamp).getTime() : 0,
            files: [],
          })),
        );
      })
      .catch(() => setEntries([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const restore = useCallback(
    (id: string) => {
      void window.electronAPI?.checkpoint?.restore?.(id).then(() => {
        refresh();
        onRestored?.();
      });
    },
    [refresh, onRestored],
  );

  const showDiff = useCallback(
    (id: string) => {
      const commit = commitsRef.current.get(id);
      if (!commit || !cwd) return;
      void window.electronAPI?.checkpoint
        ?.compare?.(cwd, commit, 'HEAD')
        .then((raw: unknown) => {
          const list = Array.isArray(raw) ? (raw as DiffFileEntry[]) : [];
          setDiffEntries(sortDiff(list));
        })
        .catch(() => setDiffEntries([]));
    },
    [cwd],
  );

  if (entries === null) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Chargement…</div>;
  }

  return (
    <div className="relative h-full overflow-y-auto p-3">
      <CheckpointTimeline checkpoints={entries} onRestore={restore} {...(cwd ? { onDiff: showDiff } : {})} />
      {diffEntries !== null ? (
        <div className="absolute inset-0 z-10 bg-background/95 p-3">
          <CheckpointDiffView entries={diffEntries} onClose={() => setDiffEntries(null)} />
        </div>
      ) : null}
    </div>
  );
}
