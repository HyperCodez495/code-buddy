/**
 * ExportDialogHost — a live home for the `/export` and `/save` slash commands.
 *
 * Those commands dispatch a `cowork:open-export` window event (see commands/slash-command-actions).
 * Its only listener used to live in `Sidebar.tsx`, which the current shell never mounts — so
 * `/export` and `/save` silently did nothing. This tiny always-mounted host re-homes that contract
 * (listener + ExportDialog), so the commands work in both the old and new shells. Renders nothing
 * until an export is requested.
 */
import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { ExportDialog } from './ExportDialog';

export function ExportDialogHost() {
  const sessions = useAppStore((s) => s.sessions);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
      if (!id) return;
      setSessionId(id);
      setSessionTitle(sessions.find((s) => s.id === id)?.title);
    };
    window.addEventListener('cowork:open-export', open);
    return () => window.removeEventListener('cowork:open-export', open);
  }, [sessions]);

  if (!sessionId) return null;
  return (
    <ExportDialog
      sessionId={sessionId}
      sessionTitle={sessionTitle}
      onClose={() => {
        setSessionId(null);
        setSessionTitle(undefined);
      }}
    />
  );
}
