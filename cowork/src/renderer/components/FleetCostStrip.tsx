/**
 * FleetCostStrip — fleet spend observability in the Command Center.
 *
 * Read-only view over the core CostTracker ledger (the same one the
 * dispatch cost gate charges): today's spend vs the daily cap with a
 * headroom bar, the 7-day total, and today's breakdown by peer and by
 * provider. Refreshes with the saga update token so a finished dispatch
 * is reflected without manual polling.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleDollarSign, Loader2, RefreshCw } from 'lucide-react';

interface CostSummaryView {
  todayUsd: number;
  todayByProvider: Record<string, number>;
  todayByPeer: Record<string, number>;
  weekUsd: number;
}

interface CostBudgetView {
  maxDailyUsd: number;
  maxSagaUsd: number;
}

function formatUsd(value: number): string {
  return value < 0.005 && value > 0 ? '<0.01$' : `${value.toFixed(2)}$`;
}

function topEntries(record: Record<string, number>, limit = 3): Array<[string, number]> {
  return Object.entries(record)
    .filter(([, usd]) => usd > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);
}

export const FleetCostStrip: React.FC<{ refreshToken?: number }> = ({ refreshToken = 0 }) => {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<CostSummaryView | null>(null);
  const [budget, setBudget] = useState<CostBudgetView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const api = window.electronAPI as unknown as {
        fleet?: {
          costSummary?: () => Promise<{
            ok: boolean;
            error?: string;
            summary?: CostSummaryView;
            budget?: CostBudgetView;
          }>;
        };
      };
      if (!api?.fleet?.costSummary) return;
      const result = await api.fleet.costSummary();
      if (result.ok && result.summary) {
        setSummary(result.summary);
        setBudget(result.budget ?? null);
        setError(null);
      } else {
        setError(result.error ?? 'cost summary unavailable');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const dailyCap = budget?.maxDailyUsd ?? 0;
  const todayUsd = summary?.todayUsd ?? 0;
  const usedPct = dailyCap > 0 ? Math.min(100, (todayUsd / dailyCap) * 100) : 0;
  const peers = topEntries(summary?.todayByPeer ?? {});
  const providers = topEntries(summary?.todayByProvider ?? {});

  return (
    <section
      className="rounded border border-border-muted bg-surface/60 px-3 py-2 text-xs"
      data-testid="fleet-cost-strip"
    >
      <div className="flex items-center gap-2">
        <CircleDollarSign size={12} className="text-text-muted shrink-0" />
        <span className="text-[10px] uppercase tracking-wider text-text-muted">
          {t('fleet.cost.title', 'Fleet spend')}
        </span>
        {summary && (
          <span className="tabular-nums text-text-secondary" data-testid="fleet-cost-today">
            {t('fleet.cost.today', 'today')} {formatUsd(todayUsd)}
            {dailyCap > 0 && <span className="text-text-muted"> / {formatUsd(dailyCap)}</span>}
          </span>
        )}
        {summary && (
          <span className="tabular-nums text-text-muted" data-testid="fleet-cost-week">
            {t('fleet.cost.week', '7d')} {formatUsd(summary.weekUsd)}
          </span>
        )}
        <button
          onClick={() => void load()}
          className="ml-auto p-1 text-text-muted hover:text-text-primary"
          title={t('common.refresh', 'Refresh')}
          data-testid="fleet-cost-refresh"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
        </button>
      </div>
      {dailyCap > 0 && summary && (
        <div className="mt-1.5 h-1 bg-surface rounded overflow-hidden">
          <div
            className={`h-full transition-all ${usedPct >= 90 ? 'bg-error' : usedPct >= 60 ? 'bg-warning' : 'bg-success'}`}
            style={{ width: `${usedPct}%` }}
            data-testid="fleet-cost-bar"
          />
        </div>
      )}
      {(peers.length > 0 || providers.length > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
          {peers.map(([peerId, usd]) => (
            <span
              key={`peer-${peerId}`}
              className="rounded border border-border bg-surface/80 px-1.5 py-0.5 text-text-secondary"
              data-testid="fleet-cost-peer-chip"
            >
              <span className="font-mono">{peerId}</span>{' '}
              <span className="tabular-nums text-text-muted">{formatUsd(usd)}</span>
            </span>
          ))}
          {providers.map(([provider, usd]) => (
            <span
              key={`provider-${provider}`}
              className="rounded border border-border-muted bg-surface/60 px-1.5 py-0.5 text-text-muted"
              data-testid="fleet-cost-provider-chip"
            >
              {provider} <span className="tabular-nums">{formatUsd(usd)}</span>
            </span>
          ))}
        </div>
      )}
      {summary && todayUsd === 0 && (
        <p className="mt-1 text-[10px] text-text-muted" data-testid="fleet-cost-zero">
          {t('fleet.cost.zero', 'No paid spend today — the fleet is running on free local models.')}
        </p>
      )}
      {error && (
        <p className="mt-1 text-[10px] text-error" data-testid="fleet-cost-error">
          {error}
        </p>
      )}
    </section>
  );
};
