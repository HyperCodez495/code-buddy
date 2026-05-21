/**
 * CostTrendsDashboard — P5.2
 *
 * Polls cost.history + cost.modelBreakdown and renders pure-CSS bar
 * charts showing daily spend over last 30 days and per-model breakdown.
 * No external viz dep.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, TrendingUp, DollarSign } from 'lucide-react';

interface CostTrendsDashboardProps {
  onClose: () => void;
}

interface HistoryEntry {
  date: string;
  cost: number;
  calls: number;
}

interface ModelBreakdownEntry {
  model: string;
  cost: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export function CostTrendsDashboard({ onClose }: CostTrendsDashboardProps) {
  const { t } = useTranslation();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [breakdown, setBreakdown] = useState<ModelBreakdownEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const histApi = window.electronAPI?.cost?.history;
    const bdApi = window.electronAPI?.cost?.modelBreakdown;
    if (!histApi || !bdApi) {
      setLoading(false);
      return;
    }
    Promise.all([histApi(30), bdApi(30)])
      .then(([h, b]) => {
        setHistory(h as HistoryEntry[]);
        setBreakdown(b as ModelBreakdownEntry[]);
      })
      .finally(() => setLoading(false));
  }, []);

  const maxDailyCost = useMemo(() => Math.max(1, ...history.map((h) => h.cost)), [history]);
  const totalSpend = useMemo(() => history.reduce((acc, h) => acc + h.cost, 0), [history]);
  const maxModelCost = useMemo(() => Math.max(1, ...breakdown.map((b) => b.cost)), [breakdown]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4" role="dialog" aria-modal="true" data-testid="cost-trends-dashboard">
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">{t('costTrends.title', 'Cost trends (30d)')}</h2>
            <span className="text-[11px] text-text-muted flex items-center gap-1">
              <DollarSign size={11} />
              {totalSpend.toFixed(2)}
            </span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && <p className="text-xs text-text-muted">{t('common.loading', 'Loading...')}</p>}
          {!loading && history.length === 0 && (
            <p className="text-xs italic text-text-muted">{t('costTrends.noData', 'No usage in the last 30 days.')}</p>
          )}
          {history.length > 0 && (
            <div>
              <h3 className="text-xs font-medium mb-2 text-text-secondary">{t('costTrends.daily', 'Daily spend')}</h3>
              <div className="flex items-end gap-0.5 h-32">
                {history.map((d) => {
                  const h = (d.cost / maxDailyCost) * 100;
                  return (
                    <div
                      key={d.date}
                      className="flex-1 bg-accent/30 hover:bg-accent transition-colors rounded-sm relative group"
                      style={{ height: `${Math.max(2, h)}%`, minHeight: '2px' }}
                      title={`${d.date}: $${d.cost.toFixed(2)} (${d.calls} calls)`}
                    >
                      <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-text-muted opacity-0 group-hover:opacity-100 whitespace-nowrap">
                        ${d.cost.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1 text-[10px] text-text-muted">
                <span>{history[0]?.date}</span>
                <span>{history[history.length - 1]?.date}</span>
              </div>
            </div>
          )}

          {breakdown.length > 0 && (
            <div>
              <h3 className="text-xs font-medium mb-2 text-text-secondary">{t('costTrends.byModel', 'Per-model breakdown')}</h3>
              <div className="space-y-1">
                {breakdown.slice(0, 10).map((m) => {
                  const pct = (m.cost / maxModelCost) * 100;
                  return (
                    <div key={m.model} className="flex items-center gap-2 text-xs">
                      <span className="w-44 truncate font-mono">{m.model}</span>
                      <div className="flex-1 h-3 bg-surface rounded-full overflow-hidden">
                        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-20 text-right tabular-nums">${m.cost.toFixed(2)}</span>
                      <span className="w-16 text-right text-text-muted tabular-nums">{m.calls}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
