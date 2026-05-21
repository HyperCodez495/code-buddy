/**
 * BtwQuickAsk — P3.9
 *
 * Lightweight "by the way" one-shot question popup. Shortcut Cmd/Ctrl+Shift+/.
 * Invokes the `/btw` slash command which performs a single LLM call without
 * tools and without mutating session history. Answer rendered inline.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, X, Loader2 } from 'lucide-react';
import { useAppStore } from '../store';

interface BtwQuickAskProps {
  onClose: () => void;
}

export function BtwQuickAsk({ onClose }: BtwQuickAskProps) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeSessionId = useAppStore((s) => s.activeSessionId);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setAnswer(null);
    setError(null);
    const api = window.electronAPI?.command?.execute;
    if (!api) {
      setError(t('btw.notAvailable', '/btw command not available.'));
      setLoading(false);
      return;
    }
    try {
      const result = await api('btw', [prompt.trim()], activeSessionId ?? undefined);
      if (result?.error) {
        setError(result.error);
      } else if (result?.message) {
        setAnswer(result.message);
      } else if (result?.prompt) {
        // Some backends echo the resolved prompt — show as answer for V1.
        setAnswer(result.prompt);
      } else if (result?.handled) {
        setAnswer(t('btw.queued', 'Asked. Reply will appear in the chat.'));
      } else {
        setAnswer(t('btw.noAnswer', 'No answer returned.'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center px-4 pt-32"
      data-testid="btw-quick-ask"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">
              {t('btw.title', 'By the way…')}
            </h2>
            <span className="text-[10px] text-text-muted">
              {t('btw.subtitle', 'one-shot, no tools, no history mutation')}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover"
          >
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('btw.placeholder', 'Ask a quick question without touching the conversation…')}
            rows={3}
            className="w-full px-3 py-2 text-sm rounded-md bg-surface border border-border-subtle focus:outline-none focus:border-accent resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            data-testid="btw-input"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-muted">
              {t('btw.shortcutHint', 'Cmd/Ctrl+Enter to send')}
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={loading || !prompt.trim()}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-accent text-background disabled:opacity-40 hover:bg-accent-hover"
              data-testid="btw-submit"
            >
              {loading && <Loader2 size={12} className="animate-spin" />}
              {loading ? t('btw.asking', 'Asking…') : t('btw.ask', 'Ask')}
            </button>
          </div>
          {error && (
            <div className="text-[11px] text-error bg-error/10 px-2 py-1 rounded">{error}</div>
          )}
          {answer && (
            <div className="border-t border-border-muted pt-3 text-sm text-text-primary whitespace-pre-wrap max-h-72 overflow-y-auto">
              {answer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
