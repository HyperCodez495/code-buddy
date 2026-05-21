/**
 * LiveBudgetMeter — P1.2
 *
 * Compact $$$ meter in the chat header: session cost, daily cost vs daily
 * limit (or monthly budget), color-coded by quota usage. Polls `cost.summary`
 * every 5 s and on every message append, so users can see what each turn
 * actually costs without leaving the chat.
 */
import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useActiveSessionMessages } from '../store/selectors';

interface CostSummary {
  totalCost: number;
  sessionCost: number;
  dailyCost: number;
  weeklyCost?: number;
  monthlyCost?: number;
  budgetLimit?: number;
  dailyLimit?: number;
}

function formatUSD(n: number): string {
  if (n < 0.01) return '<$0.01';
  if (n < 10) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(1)}`;
}

export function LiveBudgetMeter() {
  const { t } = useTranslation();
  const messages = useActiveSessionMessages();
  const [summary, setSummary] = useState<CostSummary | null>(null);

  useEffect(() => {
    const api = window.electronAPI?.cost?.summary;
    if (!api) return;
    let cancelled = false;
    const fetchSummary = async () => {
      try {
        const data = await api();
        if (!cancelled) setSummary(data);
      } catch {
        if (!cancelled) setSummary(null);
      }
    };
    void fetchSummary();
    const interval = setInterval(fetchSummary, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Re-trigger on message changes to refresh after each turn.
  }, [messages.length]);

  const { pct, colorClass, textClass, quotaLabel } = useMemo(() => {
    if (!summary) {
      return { pct: 0, colorClass: 'bg-success', textClass: 'text-text-muted', quotaLabel: '' };
    }
    const limit = summary.dailyLimit ?? summary.budgetLimit;
    const usage = summary.dailyLimit != null ? summary.dailyCost : summary.totalCost;
    if (!limit || limit <= 0) {
      return {
        pct: 0,
        colorClass: 'bg-success',
        textClass: 'text-text-muted',
        quotaLabel: '',
      };
    }
    const p = Math.min(100, (usage / limit) * 100);
    const color = p > 90 ? 'bg-error' : p > 70 ? 'bg-warning' : 'bg-success';
    const text = p > 90 ? 'text-error' : p > 70 ? 'text-warning' : 'text-text-muted';
    const label = `${formatUSD(usage)} / ${formatUSD(limit)}`;
    return { pct: p, colorClass: color, textClass: text, quotaLabel: label };
  }, [summary]);

  if (!summary) return null;

  const sessionCostLabel = formatUSD(summary.sessionCost ?? 0);
  const tooltip = [
    `${t('liveBudget.session', 'Session')}: ${sessionCostLabel}`,
    summary.dailyLimit
      ? `${t('liveBudget.daily', 'Today')}: ${formatUSD(summary.dailyCost)} / ${formatUSD(summary.dailyLimit)}`
      : summary.budgetLimit
        ? `${t('liveBudget.monthly', 'Month')}: ${formatUSD(summary.totalCost)} / ${formatUSD(summary.budgetLimit)}`
        : `${t('liveBudget.total', 'Total')}: ${formatUSD(summary.totalCost)}`,
  ].join(' · ');

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-surface-hover transition-colors cursor-help"
      title={tooltip}
      data-testid="live-budget-meter"
    >
      {quotaLabel && (
        <div className="relative w-12 h-1.5 bg-surface rounded-full overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 ${colorClass} transition-all`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <span className={`text-[10px] font-medium tabular-nums ${textClass}`}>
        {sessionCostLabel}
      </span>
    </div>
  );
}
