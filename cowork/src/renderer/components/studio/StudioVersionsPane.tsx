/**
 * StudioVersionsPane — container wiring the presentational CheckpointTimeline
 * (vague Codex C) onto the REAL ghost-snapshot engine: checkpoint.list feeds
 * the timeline, restore goes through checkpoint.restore (ghost snapshots are
 * undo/redo-able, so a restore is never destructive). The caller refreshes
 * the file tree after a restore.
 */
import { useCallback, useEffect, useState } from 'react';

import { CheckpointTimeline } from './CheckpointTimeline';
import type { CheckpointEntry } from './checkpoint-timeline-model';

interface GhostSnapshotWire {
  id: string;
  description?: string;
  timestamp?: string | Date;
  turn?: number;
}

export function StudioVersionsPane({ onRestored }: { onRestored?: () => void }) {
  const [entries, setEntries] = useState<CheckpointEntry[] | null>(null);

  const refresh = useCallback(() => {
    void window.electronAPI?.checkpoint
      ?.list()
      .then((raw: unknown) => {
        const timeline = raw as { snapshots?: GhostSnapshotWire[] } | null;
        const snapshots = timeline?.snapshots ?? [];
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

  if (entries === null) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Chargement…</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      <CheckpointTimeline checkpoints={entries} onRestore={restore} />
    </div>
  );
}
