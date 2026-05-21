/**
 * BatchExecutionDialog — P3.1
 *
 * Minimal launcher for /batch — user types a high-level goal, dialog
 * forwards it to the core via the command.execute bridge. The agent
 * decomposes and runs sub-tasks in parallel; results stream into the
 * active session.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Layers, Loader2 } from 'lucide-react';
import { useAppStore } from '../store';

interface BatchExecutionDialogProps {
  onClose: () => void;
}

export function BatchExecutionDialog({ onClose }: BatchExecutionDialogProps) {
  const { t } = useTranslation();
  const [goal, setGoal] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeSessionId = useAppStore((s) => s.activeSessionId);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    if (!goal.trim()) return;
    setRunning(true);
    setError(null);
    const api = window.electronAPI?.command?.execute;
    if (!api) {
      setError(t('batch.notAvailable', '/batch command not available.'));
      setRunning(false);
      return;
    }
    try {
      const result = await api('batch', [goal.trim()], activeSessionId ?? undefined);
      if (result?.error) {
        setError(result.error);
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      data-testid="batch-execution-dialog"
    >
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">{t('batch.title', 'Batch execution')}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover">
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-text-muted">
            {t(
              'batch.intro',
              'Describe a high-level goal. The agent will decompose it into parallel sub-tasks and execute them.'
            )}
          </p>
          <textarea
            ref={inputRef}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={t('batch.placeholder', 'e.g. Audit all 30 React components for unused props')}
            rows={4}
            className="w-full px-3 py-2 text-sm rounded-md bg-surface border border-border-subtle focus:outline-none focus:border-accent"
            data-testid="batch-goal"
          />
          {error && <p className="text-[11px] text-error">{error}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={running || !goal.trim()}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-md bg-accent text-background hover:bg-accent-hover disabled:opacity-40"
            data-testid="batch-submit"
          >
            {running && <Loader2 size={14} className="animate-spin" />}
            {running ? t('batch.launching', 'Launching…') : t('batch.launch', 'Launch batch')}
          </button>
        </div>
      </div>
    </div>
  );
}
