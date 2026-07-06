/**
 * DrivePanel — the Genspark AI Drive on REAL files: lists the deliverables
 * the agent actually produced in a workspace directory (via the existing
 * artifacts.listRecentFiles IPC) and opens them in the system file manager.
 * Self-contained (Labs-promotable, no props).
 */
import { FolderOpen, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../store';
import { DriveGrid } from '../DriveGrid.js';
import type { DriveItem } from '../../utils/drive-index.js';
import { toDriveItems } from './drive-real-model.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function DrivePanel() {
  const workingDir = useAppStore((st) => st.workingDir);
  const sessions = useAppStore((st) => st.sessions);
  // Best default: the newest session cwd, else the configured working dir.
  const defaultDir = sessions.find((s) => s.cwd)?.cwd ?? workingDir ?? '';
  const [dir, setDir] = useState(defaultDir);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (target: string) => {
    if (!target.trim()) return;
    setLoading(true);
    try {
      const entries = await window.electronAPI.artifacts.listRecentFiles(target.trim(), Date.now() - WEEK_MS, 200);
      setItems(toDriveItems(entries ?? []));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dir) void refresh(dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3" data-testid="drive-panel">
      <div className="flex items-center gap-2">
        <input
          value={dir}
          onChange={(event) => setDir(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void refresh(dir);
          }}
          placeholder="Dossier à indexer (absolu)"
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={() => void refresh(dir)}
          disabled={loading || !dir.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Indexer
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DriveGrid
          items={items}
          onOpen={(item) => {
            void window.electronAPI.showItemInFolder(item.id);
          }}
          onTag={() => {}}
        />
      </div>

      <p className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
        {items.length} livrable{items.length > 1 ? 's' : ''} réel{items.length > 1 ? 's' : ''} (7 derniers jours) — clic = afficher dans le dossier.
      </p>
    </div>
  );
}
