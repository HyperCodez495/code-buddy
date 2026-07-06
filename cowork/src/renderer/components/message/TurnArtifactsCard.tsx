/**
 * TurnArtifactsCard — Genspark-style task result: once the turn is done, the
 * files the agent produced are surfaced under the conversation instead of
 * staying buried in the activity trace. Reuses the bolt split's pure
 * `changedFilesFromTrace` on the session's REAL trace steps; a click reveals
 * the file in the OS file manager.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileCheck2, FilePlus2, FilePen, FileX2 } from 'lucide-react';

import { useAppStore } from '../../store';
import { changedFilesFromTrace } from '../studio/trace-changes';

function kindIcon(kind: string) {
  if (kind === 'added') return <FilePlus2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />;
  if (kind === 'deleted') return <FileX2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />;
  return <FilePen className="h-3.5 w-3.5 text-warning" aria-hidden="true" />;
}

export function TurnArtifactsCard({ sessionId }: { sessionId: string }) {
  const sessionState = useAppStore((s) => s.sessionStates[sessionId]);
  const sessions = useAppStore((s) => s.sessions);
  const [open, setOpen] = useState(true);

  const files = useMemo(
    () => changedFilesFromTrace(sessionState?.traceSteps ?? []),
    [sessionState?.traceSteps],
  );

  // Only once the turn has settled, and only when something was produced.
  if (sessionState?.activeTurn || files.length === 0) return null;
  const cwd = sessions.find((s) => s.id === sessionId)?.cwd;

  return (
    <div className="mx-auto mb-3 w-full max-w-3xl px-4" data-testid="turn-artifacts-card">
      <div className="rounded-xl border border-border bg-surface">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          )}
          <FileCheck2 className="h-4 w-4 text-success" aria-hidden="true" />
          <span className="text-xs font-medium text-foreground">
            Fichiers produits · {files.length}
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground">clic = afficher dans le dossier</span>
        </button>
        {open ? (
          <ul className="border-t border-border px-3 py-2">
            {files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => void window.electronAPI?.showItemInFolder?.(file.path, cwd)}
                  className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-background"
                  title={file.path}
                >
                  {kindIcon(file.kind)}
                  <code className="min-w-0 flex-1 truncate text-xs text-foreground">{file.path}</code>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {file.kind === 'added' ? 'créé' : file.kind === 'deleted' ? 'supprimé' : 'modifié'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
