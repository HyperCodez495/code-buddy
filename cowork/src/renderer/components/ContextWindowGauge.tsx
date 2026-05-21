/**
 * ContextWindowGauge — Claude Cowork parity Phase 3 step 16
 *
 * Compact horizontal gauge that shows the active session's context usage
 * against the model's window. Fetches the per-model limit via
 * `window.electronAPI.model.capabilities` and reads live token counts
 * from the session state (updated by `session.contextInfo` events).
 *
 * Color thresholds:
 *   < 70% → success
 *   70–90% → warning
 *   > 90% → error
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Scissors } from 'lucide-react';
import { useAppStore } from '../store';
import { useCurrentSession } from '../store/selectors';
import { CompactStrategyDialog } from './CompactStrategyDialog';

interface ModelCapabilities {
  contextWindow: number;
  maxOutputTokens: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function ContextWindowGauge() {
  const { t } = useTranslation();
  const session = useCurrentSession();
  const sessionStates = useAppStore((s) => s.sessionStates);
  const sessionState = session ? sessionStates[session.id] : null;
  const tokensUsed = sessionState?.contextWindow ?? 0;
  const [capabilities, setCapabilities] = useState<ModelCapabilities | null>(null);
  const [showCompactDialog, setShowCompactDialog] = useState(false);

  useEffect(() => {
    if (!session?.model || !window.electronAPI?.model?.capabilities) {
      setCapabilities(null);
      return;
    }
    let cancelled = false;
    window.electronAPI.model
      .capabilities(session.model)
      .then((caps) => {
        if (!cancelled) setCapabilities(caps);
      })
      .catch(() => {
        if (!cancelled) setCapabilities(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.model]);

  const limit = capabilities?.contextWindow ?? 200_000;
  const pct = Math.min(100, (tokensUsed / limit) * 100);

  const colorClass = useMemo(() => {
    if (pct > 90) return 'bg-error';
    if (pct > 70) return 'bg-warning';
    return 'bg-success';
  }, [pct]);

  const textClass = useMemo(() => {
    if (pct > 90) return 'text-error';
    if (pct > 70) return 'text-warning';
    return 'text-text-muted';
  }, [pct]);

  if (!session) return null;

  const tooltip = `${formatTokens(tokensUsed)} / ${formatTokens(limit)} ${t('contextGauge.tokens', 'tokens')} (${pct.toFixed(1)}%)`;

  return (
    <>
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-surface-hover transition-colors cursor-help group"
        title={tooltip}
      >
        <div className="relative w-16 h-1.5 bg-surface rounded-full overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 ${colorClass} transition-all`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={`text-[10px] font-medium tabular-nums ${textClass}`}>
          {formatTokens(tokensUsed)}
        </span>
        <button
          type="button"
          onClick={() => setShowCompactDialog(true)}
          className={`opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 flex items-center justify-center rounded ${pct > 70 ? 'opacity-100' : ''}`}
          title={t('compact.runNow', 'Compact now')}
          data-testid="context-gauge-compact-btn"
        >
          <Scissors className={`w-3 h-3 ${pct > 90 ? 'text-error' : pct > 70 ? 'text-warning' : 'text-text-muted'}`} />
        </button>
      </div>
      {showCompactDialog && session && (
        <CompactStrategyDialog
          sessionId={session.id}
          onClose={() => setShowCompactDialog(false)}
        />
      )}
    </>
  );
}
