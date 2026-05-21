/**
 * AgentMonitoringDashboard — P5.1
 *
 * Lightweight, recharts-free dashboard showing tool-call timeline, error
 * rates, and top tools in the active session. Data source: `trace_steps`
 * via session.contextInfo events surfaced through the store.
 *
 * Pure CSS bars — no viz dep needed.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Activity, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '../store';
import type { TraceStep } from '../types';

interface AgentMonitoringDashboardProps {
  onClose: () => void;
}

export function AgentMonitoringDashboard({ onClose }: AgentMonitoringDashboardProps) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessionStates = useAppStore((s) => s.sessionStates);
  const [steps, setSteps] = useState<TraceStep[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!activeSessionId) return;
    const state = sessionStates[activeSessionId] as unknown as { traceSteps?: TraceStep[] } | undefined;
    if (state?.traceSteps) setSteps(state.traceSteps);
  }, [activeSessionId, sessionStates]);

  const stats = useMemo(() => {
    const toolUses = steps.filter((s) => s.type === 'tool_call');
    const errors = toolUses.filter((s) => s.isError === true).length;
    const total = toolUses.length;
    const successRate = total ? Math.round(((total - errors) / total) * 100) : 100;
    const byTool = new Map<string, { count: number; errors: number }>();
    for (const s of toolUses) {
      const name = s.toolName ?? 'unknown';
      const cur = byTool.get(name) ?? { count: 0, errors: 0 };
      cur.count++;
      if (s.isError) cur.errors++;
      byTool.set(name, cur);
    }
    const topTools = Array.from(byTool.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    const maxCount = Math.max(1, ...topTools.map((t) => t.count));
    return { total, errors, successRate, topTools, maxCount };
  }, [steps]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4" role="dialog" aria-modal="true" data-testid="agent-monitoring-dashboard">
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">{t('agentMonitor.title', 'Agent monitoring')}</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="border border-border-subtle rounded-lg p-3">
              <div className="text-[10px] uppercase text-text-muted">{t('agentMonitor.totalToolCalls', 'Total tool calls')}</div>
              <div className="text-2xl font-semibold mt-1">{stats.total}</div>
            </div>
            <div className="border border-border-subtle rounded-lg p-3">
              <div className="text-[10px] uppercase text-text-muted">{t('agentMonitor.errorCount', 'Errors')}</div>
              <div className="text-2xl font-semibold mt-1 text-error flex items-center gap-1.5">
                <AlertCircle size={18} />
                {stats.errors}
              </div>
            </div>
            <div className="border border-border-subtle rounded-lg p-3">
              <div className="text-[10px] uppercase text-text-muted">{t('agentMonitor.successRate', 'Success rate')}</div>
              <div className="text-2xl font-semibold mt-1 text-success flex items-center gap-1.5">
                <CheckCircle2 size={18} />
                {stats.successRate}%
              </div>
            </div>
          </div>

          {/* Top tools */}
          <div>
            <h3 className="text-xs font-medium mb-2 text-text-secondary">
              {t('agentMonitor.topTools', 'Top 10 tools')}
            </h3>
            {stats.topTools.length === 0 ? (
              <p className="text-[11px] italic text-text-muted">{t('agentMonitor.empty', 'No tool calls yet in this session.')}</p>
            ) : (
              <div className="space-y-1">
                {stats.topTools.map((tool) => {
                  const pct = (tool.count / stats.maxCount) * 100;
                  const errPct = tool.count ? (tool.errors / tool.count) * 100 : 0;
                  return (
                    <div key={tool.name} className="flex items-center gap-2 text-xs">
                      <span className="w-32 truncate font-mono">{tool.name}</span>
                      <div className="flex-1 h-3 bg-surface rounded-full overflow-hidden relative">
                        <div className="absolute inset-y-0 left-0 bg-accent/40" style={{ width: `${pct}%` }} />
                        {errPct > 0 && (
                          <div className="absolute inset-y-0 left-0 bg-error/60" style={{ width: `${(pct * errPct) / 100}%` }} />
                        )}
                      </div>
                      <span className="w-16 text-right tabular-nums">{tool.count}</span>
                      {tool.errors > 0 && <span className="w-12 text-right tabular-nums text-error">{tool.errors} err</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
