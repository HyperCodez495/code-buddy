/**
 * CompactStrategyDialog — P1.4
 *
 * Modal letting the user trigger context compaction with a chosen strategy.
 * Submits via the core slash command `/compact <strategy>` through the
 * existing `command.execute` IPC channel, so it reuses the same code path
 * the CLI uses.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Scissors, AlertCircle } from 'lucide-react';

type CompactStrategy = 'aggressive' | 'balanced' | 'preserve-tools';

interface CompactStrategyDialogProps {
  sessionId: string;
  onClose: () => void;
}

const STRATEGIES: { id: CompactStrategy; titleKey: string; descKey: string; fallback: { title: string; desc: string } }[] = [
  {
    id: 'aggressive',
    titleKey: 'compact.aggressive.title',
    descKey: 'compact.aggressive.desc',
    fallback: {
      title: 'Aggressive',
      desc: 'Maximum token savings — summarize older messages and drop tool outputs.',
    },
  },
  {
    id: 'balanced',
    titleKey: 'compact.balanced.title',
    descKey: 'compact.balanced.desc',
    fallback: {
      title: 'Balanced (recommended)',
      desc: 'Summarize older messages, keep recent tool outputs intact.',
    },
  },
  {
    id: 'preserve-tools',
    titleKey: 'compact.preserveTools.title',
    descKey: 'compact.preserveTools.desc',
    fallback: {
      title: 'Preserve tools',
      desc: 'Summarize text only, keep all tool calls and results verbatim.',
    },
  },
];

export function CompactStrategyDialog({ sessionId, onClose }: CompactStrategyDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<CompactStrategy>('balanced');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const api = window.electronAPI?.command?.execute;
      if (!api) {
        setError(t('compact.notAvailable', 'Compact command not available.'));
        setSubmitting(false);
        return;
      }
      const result = await api('compact', [selected], sessionId);
      if (result?.error) {
        setError(result.error);
        setSubmitting(false);
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      data-testid="compact-strategy-dialog"
    >
      <div className="bg-background border border-border rounded-2xl shadow-xl max-w-lg w-full overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <Scissors size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">
              {t('compact.dialogTitle', 'Compact context')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover"
            title={t('common.close', 'Close')}
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-xs text-text-muted">
            {t(
              'compact.dialogIntro',
              'Compaction summarises older parts of the conversation to free up context window for new turns. Choose a strategy:',
            )}
          </p>
          <div className="space-y-2">
            {STRATEGIES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(s.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                  selected === s.id
                    ? 'border-accent bg-accent/5'
                    : 'border-border-subtle hover:bg-surface-hover'
                }`}
                data-testid={`compact-strategy-${s.id}`}
              >
                <div className="text-sm font-medium">{t(s.titleKey, s.fallback.title)}</div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {t(s.descKey, s.fallback.desc)}
                </div>
              </button>
            ))}
          </div>
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-error/10 border border-error/30 text-error text-xs">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border-muted flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md text-text-secondary hover:bg-surface-hover"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className="px-3 py-1.5 text-xs rounded-md bg-accent text-background disabled:opacity-50 hover:bg-accent-hover"
            data-testid="compact-confirm"
          >
            {submitting
              ? t('compact.running', 'Compacting…')
              : t('compact.runNow', 'Compact now')}
          </button>
        </div>
      </div>
    </div>
  );
}
