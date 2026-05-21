/**
 * WatchedFilesPanel — P3.7
 *
 * Lists currently watched files / globs and lets the user add or stop
 * watchers. Triggers the /watch slash command for start/stop. Source of
 * truth on the backend is `file-watcher-trigger.ts`.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Eye, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../store';

interface WatchedFilesPanelProps {
  onClose: () => void;
}

export function WatchedFilesPanel({ onClose }: WatchedFilesPanelProps) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const [watchers, setWatchers] = useState<string[]>([]);
  const [newPattern, setNewPattern] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // V1: we hold watcher patterns in component state. Once a dedicated
  // bridge exists (watcher.list), wire it here.
  const addWatcher = async () => {
    if (!newPattern.trim()) return;
    const api = window.electronAPI?.command?.execute;
    if (!api) {
      setError(t('watch.notAvailable', '/watch not available.'));
      return;
    }
    try {
      const result = await api('watch', ['start', newPattern.trim()], activeSessionId ?? undefined);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setWatchers((prev) => [...prev, newPattern.trim()]);
      setNewPattern('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeWatcher = async (pattern: string) => {
    const api = window.electronAPI?.command?.execute;
    if (!api) return;
    try {
      await api('watch', ['stop', pattern], activeSessionId ?? undefined);
      setWatchers((prev) => prev.filter((p) => p !== pattern));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4" role="dialog" aria-modal="true" data-testid="watched-files-panel">
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-xl w-full max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <Eye size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">{t('watch.title', 'File watchers')}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <p className="text-xs text-text-muted">
            {t('watch.intro', 'Patterns are forwarded to /watch start. The agent re-runs on file changes.')}
          </p>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              placeholder={t('watch.placeholder', 'e.g. src/**/*.ts')}
              className="flex-1 px-3 py-1.5 text-sm rounded-md bg-surface border border-border-subtle focus:outline-none focus:border-accent"
              data-testid="watch-pattern"
            />
            <button
              type="button"
              onClick={addWatcher}
              disabled={!newPattern.trim()}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-accent text-background hover:bg-accent-hover disabled:opacity-40"
              data-testid="watch-add"
            >
              <Plus size={12} />
              {t('watch.add', 'Watch')}
            </button>
          </div>
          {error && <p className="text-[11px] text-error">{error}</p>}
          {watchers.length === 0 ? (
            <p className="text-[11px] italic text-text-muted">{t('watch.empty', 'No active watchers in this session.')}</p>
          ) : (
            <ul className="space-y-1">
              {watchers.map((pattern) => (
                <li key={pattern} className="flex items-center justify-between px-2 py-1.5 rounded border border-border-subtle">
                  <span className="text-xs font-mono">{pattern}</span>
                  <button
                    type="button"
                    onClick={() => removeWatcher(pattern)}
                    className="p-1 rounded hover:bg-error/10 text-text-muted hover:text-error"
                    data-testid={`watch-remove-${pattern}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
