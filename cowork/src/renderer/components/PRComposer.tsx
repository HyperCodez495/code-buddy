/**
 * PRComposer — P3.3
 *
 * Minimal /pr launcher dialog. Lets the user provide a title + optional
 * description and triggers /pr via the command bridge. Optional /lint
 * pre-pass via a checkbox.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, GitPullRequest, Loader2 } from 'lucide-react';
import { useAppStore } from '../store';
import { dialogA11yProps, trapFocus } from '../utils/a11y';

interface PRComposerProps {
  onClose: () => void;
}

type PRPhase = 'lint' | 'pr' | null;

export function PRComposer({ onClose }: PRComposerProps) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [runLint, setRunLint] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<PRPhase>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Live agent draft (lint fix + PR body) streams onto the session's
  // partialMessage — surface its tail instead of an opaque spinner.
  const partial = useAppStore((s) =>
    activeSessionId ? (s.sessionStates[activeSessionId]?.partialMessage ?? '') : ''
  );
  const liveTail = submitting && partial ? partial.slice(-600) : '';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (dialogRef.current) return trapFocus(dialogRef.current);
  }, []);

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
        setPhase('lint');
        await api('lint', ['fix'], activeSessionId ?? undefined);
      }
      setPhase('pr');
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
      setPhase(null);
    }
  };

  const phaseLabel =
    phase === 'lint'
      ? t('pr.phaseLint', 'Running /lint fix…')
      : phase === 'pr'
        ? t('pr.phaseDrafting', 'Drafting the pull request…')
        : t('pr.opening', 'Opening PR…');

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4" data-testid="pr-composer">
      <div
        ref={dialogRef}
        {...dialogA11yProps(t('pr.title', 'Compose pull request'))}
        className="bg-background border border-border rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <GitPullRequest size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">{t('pr.title', 'Compose pull request')}</h2>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover">
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
          {submitting && liveTail && (
            <div
              className="max-h-40 overflow-y-auto rounded-md border border-border-subtle bg-surface-muted p-2"
              data-testid="pr-draft-stream"
            >
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1">
                {phaseLabel}
              </div>
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-text-secondary">
                {liveTail}
              </pre>
            </div>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-md bg-accent text-background hover:bg-accent-hover disabled:opacity-40"
            data-testid="pr-submit"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? phaseLabel : t('pr.open', 'Open PR')}
          </button>
        </div>
      </div>
    </div>
  );
}
