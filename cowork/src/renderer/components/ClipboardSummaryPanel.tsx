/**
 * ClipboardSummaryPanel — Lisa-derived feature adapted for Cowork.
 *
 * Sits as a floating popover triggered from a clipboard icon in the
 * Titlebar. When the user enables auto-monitoring, the main process
 * polls the system clipboard every 2 s; on substantial new content,
 * it asks the configured LLM for a 2-3 sentence French summary and
 * pushes a `clipboard.summary` ServerEvent. The user can also click
 * "Résumer maintenant" to summarise the current clipboard on demand.
 *
 * Once a summary is ready, "Envoyer comme prompt" puts a templated
 * prompt into the active session's ChatView composer so the user
 * can ask follow-up questions without re-pasting the source.
 *
 * @module renderer/components/ClipboardSummaryPanel
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ClipboardCopy,
  Loader2,
  Play,
  Power,
  Send,
  X,
} from 'lucide-react';
import { useAppStore } from '../store';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Called with a pre-built prompt when user clicks "send to chat". */
  onSendToChat?: (prompt: string) => void;
}

export const ClipboardSummaryPanel: React.FC<Props> = ({
  isOpen,
  onClose,
  onSendToChat,
}) => {
  const { t } = useTranslation();
  const summary = useAppStore((s) => s.clipboardSummary);
  const monitoringEnabled = useAppStore((s) => s.clipboardMonitoringEnabled);
  const summarising = useAppStore((s) => s.clipboardSummarising);
  const setMonitoringEnabled = useAppStore((s) => s.setClipboardMonitoringEnabled);
  const setSummarising = useAppStore((s) => s.setClipboardSummarising);
  const setSummary = useAppStore((s) => s.setClipboardSummary);
  const [error, setError] = useState<string | null>(null);

  // Hydrate the toggle state from main on open.
  useEffect(() => {
    if (!isOpen) return;
    void (async () => {
      try {
        const status = await window.electronAPI?.clipboard?.status?.();
        if (status) setMonitoringEnabled(status.monitoringEnabled);
      } catch {
        /* main might not be ready */
      }
    })();
  }, [isOpen, setMonitoringEnabled]);

  // ESC closes.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const handleSummarizeNow = async () => {
    if (!window.electronAPI?.clipboard?.summarizeNow) return;
    setError(null);
    setSummarising(true);
    try {
      const result = await window.electronAPI.clipboard.summarizeNow();
      if (!result.ok) {
        setError(result.error ?? 'unknown error');
        setSummarising(false);
        return;
      }
      if (result.payload) setSummary(result.payload);
      setSummarising(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSummarising(false);
    }
  };

  const handleToggleMonitoring = async () => {
    const next = !monitoringEnabled;
    setMonitoringEnabled(next); // optimistic
    try {
      await window.electronAPI?.clipboard?.setMonitoring?.(next);
    } catch (err) {
      setMonitoringEnabled(!next); // rollback
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSendToChat = () => {
    if (!summary?.summary || !onSendToChat) return;
    const prompt =
      `J'ai copié ce texte (${summary.sourceLength} caractères) :\n\n` +
      `> ${summary.sourcePreview}…\n\n` +
      `Résumé automatique : « ${summary.summary} »\n\n` +
      `Peux-tu m'aider à propos de ce contenu ?`;
    onSendToChat(prompt);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      data-testid="clipboard-summary-panel"
    >
      <div
        className="w-[560px] max-w-[92vw] max-h-[80vh] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <ClipboardCopy size={14} className="text-accent" />
            <h2 className="text-sm font-medium text-secondary">
              {t('clipboardSummary.title', 'Résumé du presse-papiers')}
            </h2>
            {summarising && (
              <Loader2 size={11} className="animate-spin text-muted-foreground" />
            )}
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-secondary transition-colors"
            aria-label={t('common.close', 'Close')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
          <button
            type="button"
            onClick={() => void handleSummarizeNow()}
            disabled={summarising}
            data-testid="clipboard-summarize-now"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-accent text-background hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Play size={11} />
            {t('clipboardSummary.summarizeNow', 'Résumer maintenant')}
          </button>
          <button
            type="button"
            onClick={() => void handleToggleMonitoring()}
            data-testid="clipboard-monitor-toggle"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors ${
              monitoringEnabled
                ? 'bg-success/15 text-success'
                : 'bg-surface text-text-secondary hover:bg-surface-hover'
            }`}
          >
            <Power size={11} />
            {monitoringEnabled
              ? t('clipboardSummary.autoOn', 'Auto-surveillance activée')
              : t('clipboardSummary.autoOff', 'Auto-surveillance désactivée')}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="p-2 mb-3 rounded bg-error/10 border border-error/30 text-error text-xs">
              {error}
            </div>
          )}

          {!summary ? (
            <div className="text-xs text-muted-foreground text-center py-12 leading-relaxed">
              <ClipboardCopy size={28} className="mx-auto mb-2 opacity-30" />
              <p>
                {t(
                  'clipboardSummary.empty',
                  'Aucun résumé. Copiez un texte (>100 caractères) et activez l\'auto-surveillance, ou cliquez sur « Résumer maintenant ».',
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t('clipboardSummary.summaryLabel', 'Résumé')}
              </div>
              {summary.summary ? (
                <div className="text-sm text-secondary leading-relaxed whitespace-pre-wrap">
                  <span data-testid="clipboard-summary-text">
                  {summary.summary}
                  </span>
                </div>
              ) : (
                <div className="text-sm text-warning italic">
                  {t(
                    'clipboardSummary.llmFailed',
                    'Le LLM n\'a pas pu produire un résumé (réseau, clé manquante, …).',
                  )}
                </div>
              )}
              <div className="text-[10px] text-muted-foreground mt-2 italic">
                {t('clipboardSummary.sourceMeta', 'Source')} :{' '}
                {summary.sourceLength.toLocaleString()}{' '}
                {t('clipboardSummary.chars', 'caractères')} ·{' '}
                {new Date(summary.at).toLocaleTimeString()}
              </div>
              <details className="mt-2">
                <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-secondary">
                  {t('clipboardSummary.showSource', 'Voir l\'aperçu source')}
                </summary>
                <pre className="mt-2 text-[11px] text-muted-foreground bg-zinc-800/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                  {summary.sourcePreview}…
                </pre>
              </details>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {summary?.summary && onSendToChat && (
          <div className="px-5 py-3 border-t border-border shrink-0 flex justify-end">
            <button
              type="button"
              onClick={handleSendToChat}
              data-testid="clipboard-send-to-chat"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-accent text-background hover:bg-accent-hover transition-colors"
            >
              <Send size={11} />
              {t('clipboardSummary.sendToChat', 'Envoyer comme prompt')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
