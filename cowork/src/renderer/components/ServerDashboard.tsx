/**
 * ServerDashboard — modal showing live activity for the embedded
 * Code Buddy HTTP server. Triggered from the titlebar power button's
 * right-click menu. Polls every 3 s while open so the user sees new
 * requests as they arrive.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Activity, AlertCircle, Loader2, RefreshCw, Server } from 'lucide-react';

interface RecentRequest {
  timestamp: number;
  method: string;
  path: string;
  statusCode: number;
  responseTimeMs: number;
  ip: string;
}

interface DashboardData {
  recent: RecentRequest[];
  stats: {
    total: number;
    errors: number;
    averageLatency: number;
    uptime: number;
    byStatus: Record<string, number>;
  } | null;
}

interface ServerDashboardProps {
  isOpen: boolean;
  onClose: () => void;
}

function statusColor(code: number): string {
  if (code >= 500) return 'text-error';
  if (code >= 400) return 'text-warning';
  if (code >= 300) return 'text-text-muted';
  return 'text-success';
}

function formatLatency(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function timeAgo(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff < 1000) return 'now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  return `${Math.floor(diff / 3_600_000)}h`;
}

export const ServerDashboard: React.FC<ServerDashboardProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardData>({ recent: [], stats: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Close on Escape
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

  // Refresh data + clock while open
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const refresh = async () => {
      if (!window.electronAPI?.server?.dashboard) return;
      setLoading(true);
      try {
        const result = await window.electronAPI.server.dashboard();
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void refresh();
    const refreshId = setInterval(refresh, 3000);
    const clockId = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(refreshId);
      clearInterval(clockId);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const stats = data.stats;
  const errorRate =
    stats && stats.total > 0 ? Math.round((stats.errors / stats.total) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-[720px] max-w-[94vw] max-h-[85vh] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <Server size={14} className="text-success" />
            <h2 className="text-sm font-medium text-zinc-200">
              {t('serverDashboard.title', 'Server activity')}
            </h2>
            {loading && <Loader2 size={11} className="animate-spin text-zinc-500" />}
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label={t('common.close', 'Close')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Stats grid */}
        {stats ? (
          <div className="grid grid-cols-4 gap-2 px-5 py-3 border-b border-zinc-800 shrink-0">
            <Stat label={t('serverDashboard.total', 'Requests')} value={stats.total.toString()} />
            <Stat
              label={t('serverDashboard.errors', 'Errors')}
              value={`${stats.errors} (${errorRate}%)`}
              tone={stats.errors > 0 ? 'warn' : 'ok'}
            />
            <Stat
              label={t('serverDashboard.avgLatency', 'Avg latency')}
              value={formatLatency(stats.averageLatency)}
            />
            <Stat
              label={t('serverDashboard.uptime', 'Uptime')}
              value={`${Math.floor(stats.uptime / 60)}m ${stats.uptime % 60}s`}
            />
          </div>
        ) : (
          <div className="px-5 py-3 border-b border-zinc-800 shrink-0 flex items-center gap-2 text-xs text-zinc-500">
            <Activity size={11} />
            {t('serverDashboard.noStats', 'Server is stopped — no live stats available.')}
          </div>
        )}

        {error && (
          <div className="px-5 py-2 flex items-start gap-2 text-xs text-error bg-error/10 border-b border-zinc-800">
            <AlertCircle size={12} className="mt-0.5" /> {error}
          </div>
        )}

        {/* Recent requests */}
        <div className="flex-1 overflow-y-auto">
          {data.recent.length === 0 ? (
            <div className="text-xs text-zinc-500 text-center py-12 px-5">
              {t(
                'serverDashboard.noRequests',
                'No requests yet. Hit /api/health (or any endpoint) to see live activity.'
              )}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800">
                <tr className="text-zinc-500 text-[10px] uppercase tracking-wider">
                  <th className="text-left px-3 py-2 font-medium">When</th>
                  <th className="text-left px-3 py-2 font-medium">Method</th>
                  <th className="text-left px-3 py-2 font-medium">Path</th>
                  <th className="text-right px-3 py-2 font-medium">Status</th>
                  <th className="text-right px-3 py-2 font-medium">Latency</th>
                  <th className="text-left px-3 py-2 font-medium">Client</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r, i) => (
                  <tr
                    key={`${r.timestamp}-${i}`}
                    className="border-b border-zinc-800/40 hover:bg-zinc-800/40"
                  >
                    <td className="px-3 py-1.5 text-zinc-400 tabular-nums">
                      {timeAgo(r.timestamp, now)}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-300 font-mono">{r.method}</td>
                    <td className="px-3 py-1.5 text-zinc-200 font-mono truncate max-w-[260px]" title={r.path}>
                      {r.path}
                    </td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${statusColor(r.statusCode)}`}>
                      {r.statusCode}
                    </td>
                    <td className="px-3 py-1.5 text-right text-zinc-400 tabular-nums">
                      {formatLatency(r.responseTimeMs)}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-500 font-mono truncate max-w-[160px]" title={r.ip}>
                      {r.ip === '::1' || r.ip === '127.0.0.1' ? 'localhost' : r.ip}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-zinc-800 text-[10px] text-zinc-500 shrink-0 flex items-center justify-between">
          <span className="flex items-center gap-1">
            <RefreshCw size={9} />
            {t('serverDashboard.autoRefresh', 'Auto-refresh every 3 s · Esc closes')}
          </span>
          {stats && Object.keys(stats.byStatus).length > 0 && (
            <span className="flex items-center gap-2">
              {Object.entries(stats.byStatus).map(([status, count]) => (
                <span key={status} className={statusColor(Number(status))}>
                  {status}:{count}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; tone?: 'ok' | 'warn' }> = ({
  label,
  value,
  tone,
}) => {
  const valueClass =
    tone === 'warn' ? 'text-warning' : tone === 'ok' ? 'text-success' : 'text-zinc-200';
  return (
    <div className="flex flex-col gap-0.5 px-2 py-1 rounded bg-zinc-800/40">
      <span className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className={`text-sm font-medium tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
};
