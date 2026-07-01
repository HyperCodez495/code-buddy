/**
 * ActivityPane — the embedded Activity surface of the new shell (cowork/REDESIGN.md slice 2).
 *
 * Separates *work* from *conversation*: a calm, always-scannable live work-log of the active
 * session (tool calls, reasoning, results) rendered from the session's `traceSteps`, plus a
 * one-click Undo/Redo of the last change (the core checkpoint IPC). This replaces embedding the
 * full-screen `ActivityFeed` overlay inside the new shell's Activity view.
 *
 * Plan-then-act (an approvable step list before execution) will land here in a later slice — it
 * needs the engine to pause for approval, which the GUI seam does not yet expose. This pane is the
 * surface it will live in.
 */
import { useCallback, useState } from 'react';
import { useAppStore } from '../store';
import type { TraceStep, DiffEntry } from '../types';
import { traceStepToLine, activityStatus, collectSessionDiffs } from './activity-pane-helpers';
import { DiffViewer } from './DiffViewer';

const EMPTY_STEPS: TraceStep[] = [];

const ACTION_BADGE: Record<DiffEntry['action'], { label: string; cls: string }> = {
  create: { label: 'nouveau', cls: 'text-green-500' },
  modify: { label: 'modifié', cls: 'text-amber-500' },
  delete: { label: 'supprimé', cls: 'text-red-500' },
  rename: { label: 'renommé', cls: 'text-blue-500' },
};

/** Reviewable "Fichiers modifiés" — each changed file, expandable to a side-by-side diff. */
function ChangedFiles({ diffs }: { diffs: DiffEntry[] }) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="mb-2 rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm font-medium hover:bg-accent/50"
      >
        <span>{open ? '▾' : '▸'}</span>
        Fichiers modifiés ({diffs.length})
      </button>
      {open && (
        <ul className="px-2 pb-2 space-y-1">
          {diffs.map((d) => {
            const badge = ACTION_BADGE[d.action];
            const isOpen = expanded === d.path;
            return (
              <li key={d.path} className="text-sm">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : d.path)}
                  className="w-full flex items-center gap-2 rounded px-1.5 py-1 hover:bg-accent/50 text-left"
                >
                  <span className="shrink-0 w-4 text-center text-xs text-muted-foreground">{isOpen ? '▾' : '▸'}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{d.path}</span>
                  <span className={`shrink-0 text-[10px] ${badge.cls}`}>{badge.label}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-green-500">+{d.linesAdded}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-red-500">−{d.linesRemoved}</span>
                </button>
                {isOpen && (
                  <div className="mt-1 border border-border rounded overflow-hidden">
                    <DiffViewer diff={d} readOnly />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ActivityPane() {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const traceSteps = useAppStore(
    (s) => (s.activeSessionId ? s.sessionStates[s.activeSessionId]?.traceSteps : undefined) ?? EMPTY_STEPS,
  );
  const activeTurn = useAppStore(
    (s) => (s.activeSessionId ? s.sessionStates[s.activeSessionId]?.activeTurn ?? null : null),
  );
  const diffPreviews = useAppStore((s) => (s.activeSessionId ? s.diffPreviews[s.activeSessionId] : undefined));
  const [notice, setNotice] = useState<string | null>(null);

  const checkpoint = useCallback(async (op: 'undo' | 'redo') => {
    try {
      const api = (window as unknown as { electronAPI?: { checkpoint?: Record<string, () => Promise<unknown>> } }).electronAPI;
      const fn = api?.checkpoint?.[op];
      if (!fn) {
        setNotice('Checkpoints indisponibles ici.');
        return;
      }
      await fn();
      setNotice(op === 'undo' ? 'Dernier changement annulé.' : 'Changement rétabli.');
    } catch {
      setNotice('Action impossible.');
    }
  }, []);

  const status = activityStatus(traceSteps, activeTurn);
  const lines = traceSteps.map(traceStepToLine);
  const changedFiles = collectSessionDiffs(diffPreviews);

  return (
    <div className="h-full min-h-0 flex flex-col bg-background" data-testid="activity-pane">
      {/* Header: what's happening + undo/redo */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0">
        <span className="font-semibold">Activité</span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            status.busy ? 'bg-accent text-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          {status.busy && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1 animate-pulse" />}
          {status.text}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => checkpoint('undo')}
            className="text-xs px-2 py-1 rounded-md border border-border hover:bg-accent transition-colors"
            title="Annuler le dernier changement de fichier (checkpoint)"
          >
            ↶ Annuler
          </button>
          <button
            type="button"
            onClick={() => checkpoint('redo')}
            className="text-xs px-2 py-1 rounded-md border border-border hover:bg-accent transition-colors"
            title="Rétablir"
          >
            ↷ Rétablir
          </button>
        </div>
      </div>

      {notice && (
        <div className="px-4 py-1.5 text-xs text-muted-foreground border-b border-border bg-muted/40">{notice}</div>
      )}

      {/* Live work-log */}
      <div className="flex-1 min-h-0 overflow-auto px-2 py-2">
        {activeSessionId && changedFiles.length > 0 && <ChangedFiles diffs={changedFiles} />}
        {!activeSessionId ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Aucune session active. Lance une tâche depuis Chat.
          </div>
        ) : lines.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Rien à montrer pour l’instant — l’activité s’affichera ici pendant que Code Buddy travaille.
          </div>
        ) : (
          <ol className="space-y-0.5">
            {lines.map((l) => (
              <li
                key={l.id}
                className={`flex items-start gap-2 rounded-md px-2 py-1 text-sm ${
                  l.error ? 'text-red-500' : l.running ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                <span className="mt-0.5 shrink-0 w-4 text-center">
                  {l.running ? <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse" /> : l.glyph}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-foreground">{l.label}</span>
                  {l.detail && <span className="text-muted-foreground"> — {l.detail}</span>}
                </span>
                {typeof l.durationMs === 'number' && l.durationMs > 0 && (
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                    {l.durationMs < 1000 ? `${l.durationMs}ms` : `${(l.durationMs / 1000).toFixed(1)}s`}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
