/**
 * PRComposer — P3.3
 *
 * Minimal /pr launcher dialog. Lets the user provide a title + optional
 * description and triggers /pr via the command bridge. Optional /lint
 * pre-pass via a checkbox.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, GitPullRequest, Loader2 } from 'lucide-react';
import { useAppStore } from '../store';

interface PRComposerProps {
  onClose: () => void;
}

export function PRComposer({ onClose }: PRComposerProps) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [runLint, setRunLint] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const api = window.electronAPI?.command?.execute;
    if (!api) {
      setError(t('pr.notAvailable', '/pr command not available.'));
      setSubmitting(false);
      return;
    }
    try {
      if (runLint) {
        await api('lint', ['fix'], activeSessionId ?? undefined);
      }
      const args = [title.trim()];
      if (draft) args.push('--draft');
      if (body.trim()) args.push('--body', body.trim());
      const result = await api('pr', args, activeSessionId ?? undefined);
      if (result?.error) {
        setError(result.error);
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4" role="dialog" aria-modal="true" data-testid="pr-composer">
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <GitPullRequest size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">{t('pr.title', 'Compose pull request')}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover">
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('pr.titlePlaceholder', 'Title (leave empty to auto-generate)')}
            className="w-full px-3 py-2 text-sm rounded-md bg-surface border border-border-subtle focus:outline-none focus:border-accent"
            data-testid="pr-title"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('pr.bodyPlaceholder', 'Description (optional — agent will draft if empty)')}
            rows={5}
            className="w-full px-3 py-2 text-sm rounded-md bg-surface border border-border-subtle focus:outline-none focus:border-accent"
            data-testid="pr-body"
          />
          <div className="flex items-center gap-4 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} className="accent-accent" />
              {t('pr.draft', 'Draft PR')}
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={runLint} onChange={(e) => setRunLint(e.target.checked)} className="accent-accent" />
              {t('pr.runLint', 'Run /lint fix before PR')}
            </label>
          </div>
          {error && <p className="text-[11px] text-error">{error}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-md bg-accent text-background hover:bg-accent-hover disabled:opacity-40"
            data-testid="pr-submit"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? t('pr.opening', 'Opening PR…') : t('pr.open', 'Open PR')}
          </button>
        </div>
      </div>
    </div>
  );
}
