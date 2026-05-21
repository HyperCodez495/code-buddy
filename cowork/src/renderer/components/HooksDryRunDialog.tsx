/**
 * HooksDryRunDialog — P2.5
 *
 * Lets the user fire a hook handler with a fake payload and see the result
 * without committing the hook to the active session. Calls hooks.test from
 * the preload bridge.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Play, Loader2, CheckCircle2, XCircle } from 'lucide-react';

interface HooksDryRunDialogProps {
  initialCommand?: string;
  onClose: () => void;
}

interface TestResult {
  success: boolean;
  output?: string;
  durationMs: number;
  error?: string;
}

export function HooksDryRunDialog({ initialCommand, onClose }: HooksDryRunDialogProps) {
  const { t } = useTranslation();
  const [command, setCommand] = useState(initialCommand ?? 'echo "hook test"');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async () => {
    setRunning(true);
    setResult(null);
    const api = window.electronAPI?.hooks?.test;
    if (!api) {
      setResult({ success: false, durationMs: 0, error: t('hooksDryRun.notAvailable', 'hooks.test bridge not available') });
      setRunning(false);
      return;
    }
    try {
      const res = await api({ kind: 'command', command } as never);
      setResult(res as TestResult);
    } catch (err) {
      setResult({
        success: false,
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('hooksDryRun.title', 'Hook dry-run')}
    >
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <h2 className="text-sm font-semibold">{t('hooksDryRun.title', 'Hook dry-run')}</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover">
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <label className="block text-xs">
            <span className="block mb-1 text-text-secondary">{t('hooksDryRun.commandLabel', 'Shell command to run')}</span>
            <textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-sm font-mono rounded-md bg-surface border border-border-subtle focus:outline-none focus:border-accent"
              data-testid="hooks-dryrun-command"
            />
          </label>
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-accent text-background hover:bg-accent-hover disabled:opacity-40"
            data-testid="hooks-dryrun-run"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {running ? t('hooksDryRun.running', 'Running…') : t('hooksDryRun.run', 'Run')}
          </button>
          {result && (
            <div className="border-t border-border-muted pt-3 text-xs space-y-2">
              <div className="flex items-center gap-2">
                {result.success ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-error" />
                )}
                <span className={result.success ? 'text-success' : 'text-error'}>
                  {result.success ? t('hooksDryRun.ok', 'Success') : t('hooksDryRun.failed', 'Failed')}
                </span>
                <span className="text-text-muted">{result.durationMs}ms</span>
              </div>
              {(result.output || result.error) && (
                <pre className="bg-surface/40 border border-border-subtle rounded p-2 font-mono text-[11px] max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {result.error ?? result.output}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
