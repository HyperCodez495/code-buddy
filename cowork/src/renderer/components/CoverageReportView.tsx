/**
 * CoverageReportView — P3.5
 *
 * Minimal coverage report viewer. Triggers /coverage via the command bridge
 * and displays the raw report. Refactor later to read coverage.json from
 * the workspace once the schema is stabilised.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, BarChart2, Play, Loader2 } from 'lucide-react';
import { useAppStore } from '../store';

interface CoverageReportViewProps {
  onClose: () => void;
}

export function CoverageReportView({ onClose }: CoverageReportViewProps) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async () => {
    setRunning(true);
    setError(null);
    setOutput(null);
    const api = window.electronAPI?.command?.execute;
    if (!api) {
      setError(t('coverage.notAvailable', '/coverage not available.'));
      setRunning(false);
      return;
    }
    try {
      const result = await api('coverage', [], activeSessionId ?? undefined);
      if (result?.error) setError(result.error);
      else setOutput(result?.message ?? t('coverage.queued', 'Report posted to the chat.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4" role="dialog" aria-modal="true" data-testid="coverage-report-view">
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-xl w-full max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <BarChart2 size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">{t('coverage.title', 'Coverage report')}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-accent text-background hover:bg-accent-hover disabled:opacity-40"
            data-testid="coverage-run"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {running ? t('coverage.running', 'Computing…') : t('coverage.run', 'Run /coverage')}
          </button>
          {error && <p className="text-[11px] text-error">{error}</p>}
          {output && (
            <pre className="bg-surface/40 border border-border-subtle rounded p-3 font-mono text-[11px] whitespace-pre-wrap">
              {output}
            </pre>
          )}
          <p className="text-[11px] text-text-muted italic">
            {t('coverage.hint', 'The full report posts into the active session. This panel only acknowledges the launch.')}
          </p>
        </div>
      </div>
    </div>
  );
}
