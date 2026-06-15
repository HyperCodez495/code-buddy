/**
 * WorkflowAnalyticsPanel (V24-3)
 * --------------------------------------------------------------------
 * Per-workflow analytics trends panel. Complements
 * `ExecutionStatsPanel` (current/in-memory) by hitting the persisted
 * `/api/workflows/:id/analytics?range=…` endpoint and visualising
 * time-series trends, per-node failure rates and top errors.
 *
 * Standalone component (no router/store coupling): callers pass the
 * workflow id and may override the API base path. Auto-refresh is
 * opt-in (30s) and the user can switch the range window (1h, 24h,
 * 7d, 30d). Time-series chart is rendered as a plain SVG `<path>`
 * — no new chart library introduced.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BarChart3,
  TrendingUp,
  Clock,
  XCircle,
  Activity,
  RefreshCw,
  AlertCircle,
  Inbox,
  Play,
  Pause,
} from 'lucide-react';

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

export type AnalyticsRange = '1h' | '24h' | '7d' | '30d';

// eslint-disable-next-line react-refresh/only-export-components
export const ANALYTICS_RANGES: readonly AnalyticsRange[] = [
  '1h',
  '24h',
  '7d',
  '30d',
] as const;

export interface AnalyticsPoint {
  ts: number | string;
  value: number;
}

export interface FailureRateByNode {
  nodeId: string;
  nodeLabel?: string;
  failures: number;
  total: number;
}

export interface TopError {
  error: string;
  count: number;
}

export interface AnalyticsSummary {
  totalExecutions: number;
  successRate: number;
  avgDurationMs: number;
  failureCount: number;
}

export interface AnalyticsResponse {
  successRateOverTime: AnalyticsPoint[];
  avgDurationOverTime: AnalyticsPoint[];
  failureRateByNode: FailureRateByNode[];
  topErrors: TopError[];
  summary: AnalyticsSummary;
}

export interface WorkflowAnalyticsPanelProps {
  workflowId: string;
  apiBasePath?: string;
  /** Initial range. Defaults to '24h'. */
  initialRange?: AnalyticsRange;
  /** Auto-refresh interval (ms) when toggle is ON. Defaults 30 000. */
  autoRefreshMs?: number;
  darkMode?: boolean;
}

interface FetchState {
  loading: boolean;
  error: string | null;
  data: AnalyticsResponse | null;
}

// ──────────────────────────────────────────────────────────────────
// Helpers (hoisted — pure, do not churn on render)
// ──────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function toEpoch(ts: number | string): number {
  if (typeof ts === 'number') return ts;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : 0;
}

function formatTick(ts: number | string, range: AnalyticsRange): string {
  const d = new Date(toEpoch(ts));
  if (Number.isNaN(d.getTime())) return '';
  if (range === '1h' || range === '24h') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Build the SVG path "d" attribute from a series of points. */
function buildPath(
  points: AnalyticsPoint[],
  width: number,
  height: number,
  padding: number,
  maxValue: number,
): string {
  if (points.length === 0) return '';
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const safeMax = maxValue > 0 ? maxValue : 1;
  return points
    .map((p, i) => {
      const x = padding + i * stepX;
      const y =
        padding +
        innerH - (Math.max(0, Math.min(p.value, safeMax)) / safeMax) * innerH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

// ──────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: 'default' | 'success' | 'error' | 'info';
  darkMode: boolean;
  testId: string;
}

const StatCard: React.FC<StatCardProps> = React.memo(
  ({ label, value, icon, tone, darkMode, testId }) => {
    const toneText =
      tone === 'success'
        ? 'text-green-500'
        : tone === 'error'
        ? 'text-red-500'
        : tone === 'info'
        ? 'text-blue-500'
        : darkMode
        ? 'text-white'
        : 'text-gray-900';

    return (
      <div
        data-testid={testId}
        className={`rounded-lg p-3 border ${
          darkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-white border-gray-200 shadow-sm'
        }`}
      >
        <div className="flex items-center gap-1.5 mb-1">
          {icon}
          <span
            className={`text-xs font-medium ${
              darkMode ? 'text-gray-400' : 'text-gray-500'
            }`}
          >
            {label}
          </span>
        </div>
        <div className={`text-2xl font-bold ${toneText}`}>{value}</div>
      </div>
    );
  },
);
StatCard.displayName = 'StatCard';

interface SvgLineChartProps {
  points: AnalyticsPoint[];
  color: string;
  height?: number;
  range: AnalyticsRange;
  yMax: number;
  yLabel: string;
  ariaLabel: string;
  darkMode: boolean;
  testId: string;
}

const CHART_WIDTH = 320;
const CHART_PAD = 24;

const SvgLineChart: React.FC<SvgLineChartProps> = React.memo(
  ({ points, color, height = 140, range, yMax, yLabel, ariaLabel, darkMode, testId }) => {
    const path = useMemo(
      () => buildPath(points, CHART_WIDTH, height, CHART_PAD, yMax),
      [points, height, yMax],
    );
    const stroke = darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
    const axisColor = darkMode ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
    const tickIndices =
      points.length <= 4
        ? points.map((_, i) => i)
        : [0, Math.floor(points.length / 2), points.length - 1];

    return (
      <svg
        data-testid={testId}
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${CHART_WIDTH} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
      >
        {/* Horizontal gridlines */}
        {[0.25, 0.5, 0.75].map((g) => {
          const y = CHART_PAD + (height - CHART_PAD * 2) * g;
          return (
            <line
              key={g}
              x1={CHART_PAD}
              x2={CHART_WIDTH - CHART_PAD}
              y1={y}
              y2={y}
              stroke={stroke}
              strokeDasharray="3,3"
            />
          );
        })}
        {/* X-axis ticks */}
        {tickIndices.map((i) => {
          const innerW = CHART_WIDTH - CHART_PAD * 2;
          const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
          const x = CHART_PAD + i * stepX;
          const label = points[i] ? formatTick(points[i].ts, range) : '';
          return (
            <text
              key={i}
              x={x}
              y={height - 4}
              fontSize={9}
              fill={axisColor}
              textAnchor="middle"
            >
              {label}
            </text>
          );
        })}
        {/* Y-axis max label */}
        <text x={4} y={CHART_PAD + 8} fontSize={9} fill={axisColor}>
          {yLabel}
        </text>
        {/* Line */}
        {points.length > 0 && (
          <path
            d={path}
            data-testid={`${testId}-path`}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {/* Points */}
        {points.map((p, i) => {
          const innerW = CHART_WIDTH - CHART_PAD * 2;
          const innerH = height - CHART_PAD * 2;
          const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
          const safeMax = yMax > 0 ? yMax : 1;
          const x = CHART_PAD + i * stepX;
          const y =
            CHART_PAD +
            innerH -
            (Math.max(0, Math.min(p.value, safeMax)) / safeMax) * innerH;
          return (
            <circle
              key={i}
              data-testid={`${testId}-point-${i}`}
              cx={x}
              cy={y}
              r={2.5}
              fill={color}
            />
          );
        })}
      </svg>
    );
  },
);
SvgLineChart.displayName = 'SvgLineChart';

// ──────────────────────────────────────────────────────────────────
// Main panel
// ──────────────────────────────────────────────────────────────────

export const WorkflowAnalyticsPanel: React.FC<WorkflowAnalyticsPanelProps> = ({
  workflowId,
  apiBasePath = '/api',
  initialRange = '24h',
  autoRefreshMs = 30_000,
  darkMode = false,
}) => {
  const [range, setRange] = useState<AnalyticsRange>(initialRange);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
  const [state, setState] = useState<FetchState>({
    loading: true,
    error: null,
    data: null,
  });

  // Latest abort controller — cancel in-flight requests on re-fetch/unmount.
  const abortRef = useRef<AbortController | null>(null);
  // Bump on every manual refresh to retrigger the fetch effect.
  const [refreshTick, setRefreshTick] = useState(0);

  const endpoint = `${apiBasePath}/workflows/${encodeURIComponent(
    workflowId,
  )}/analytics?range=${range}`;

  // Fetch on mount, when workflowId/range/refreshTick changes.
  useEffect(() => {
    if (!workflowId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    (async () => {
      try {
        const res = await fetch(endpoint, { signal: ctrl.signal });
        if (cancelled || ctrl.signal.aborted) return;
        if (!res.ok) {
          setState({
            loading: false,
            error: `Request failed with status ${res.status}`,
            data: null,
          });
          return;
        }
        const json = (await res.json()) as AnalyticsResponse;
        if (cancelled || ctrl.signal.aborted) return;
        setState({ loading: false, error: null, data: json });
      } catch (err) {
        if (cancelled || ctrl.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : 'Failed to load analytics';
        // Ignore abort errors — caused by us cancelling.
        if (
          err instanceof DOMException &&
          (err.name === 'AbortError' || message.toLowerCase().includes('abort'))
        ) {
          return;
        }
        setState({ loading: false, error: message, data: null });
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [endpoint, refreshTick, workflowId]);

  // Auto-refresh: re-bump the tick at the configured interval.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      setRefreshTick((t) => t + 1);
    }, autoRefreshMs);
    return () => clearInterval(id);
  }, [autoRefresh, autoRefreshMs]);

  const handleRangeChange = useCallback((next: AnalyticsRange) => {
    setRange(next);
  }, []);

  const handleManualRefresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  const handleAutoRefreshToggle = useCallback(() => {
    setAutoRefresh((v) => !v);
  }, []);

  const data = state.data;

  // Pre-compute series max values (hooks must run unconditionally; pass safe defaults).
  const successYMax = 100;
  const durationYMax = useMemo(() => {
    if (!data) return 1;
    const max = data.avgDurationOverTime.reduce(
      (m, p) => (p.value > m ? p.value : m),
      0,
    );
    return Math.max(1, max);
  }, [data]);

  const sortedNodes = useMemo(() => {
    if (!data) return [];
    return [...data.failureRateByNode].sort((a, b) => {
      const aPct = a.total > 0 ? a.failures / a.total : 0;
      const bPct = b.total > 0 ? b.failures / b.total : 0;
      return bPct - aPct;
    });
  }, [data]);

  const sortedErrors = useMemo(() => {
    if (!data) return [];
    return [...data.topErrors].sort((a, b) => b.count - a.count);
  }, [data]);

  // ──────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────

  const headerBlock = (
    <div className="flex items-center justify-between gap-2 mb-2">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-blue-500" />
        <h3
          className={`font-semibold text-sm ${
            darkMode ? 'text-white' : 'text-gray-900'
          }`}
        >
          Analytics
        </h3>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleManualRefresh}
          data-testid="analytics-refresh-btn"
          aria-label="Refresh analytics"
          className={`p-1.5 rounded ${
            darkMode
              ? 'hover:bg-gray-700 text-gray-300'
              : 'hover:bg-gray-100 text-gray-600'
          }`}
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${state.loading ? 'animate-spin' : ''}`}
          />
        </button>
        <button
          type="button"
          onClick={handleAutoRefreshToggle}
          data-testid="analytics-autorefresh-toggle"
          aria-label={autoRefresh ? 'Pause auto-refresh' : 'Start auto-refresh'}
          aria-pressed={autoRefresh}
          className={`p-1.5 rounded inline-flex items-center gap-1 text-xs ${
            autoRefresh
              ? 'bg-blue-500 text-white'
              : darkMode
              ? 'hover:bg-gray-700 text-gray-300'
              : 'hover:bg-gray-100 text-gray-600'
          }`}
        >
          {autoRefresh ? (
            <>
              <Pause className="w-3.5 h-3.5" />
              <span>Auto</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" />
              <span>Auto</span>
            </>
          )}
        </button>
      </div>
    </div>
  );

  const rangeSelector = (
    <div
      data-testid="analytics-range-selector"
      role="tablist"
      aria-label="Analytics range"
      className="inline-flex rounded-md border overflow-hidden mb-3"
      style={{ borderColor: darkMode ? '#374151' : '#e5e7eb' }}
    >
      {ANALYTICS_RANGES.map((r) => {
        const active = r === range;
        return (
          <button
            type="button"
            key={r}
            role="tab"
            aria-selected={active}
            data-testid={`analytics-range-${r}`}
            onClick={() => handleRangeChange(r)}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-blue-500 text-white'
                : darkMode
                ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {r}
          </button>
        );
      })}
    </div>
  );

  if (state.loading && !data) {
    return (
      <div className="p-4 space-y-3" data-testid="analytics-loading">
        {headerBlock}
        {rangeSelector}
        <div
          className={`h-24 rounded-lg animate-pulse ${
            darkMode ? 'bg-gray-800' : 'bg-gray-100'
          }`}
        />
        <div
          className={`h-40 rounded-lg animate-pulse ${
            darkMode ? 'bg-gray-800' : 'bg-gray-100'
          }`}
        />
        <div
          className={`h-32 rounded-lg animate-pulse ${
            darkMode ? 'bg-gray-800' : 'bg-gray-100'
          }`}
        />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="p-4 space-y-3">
        {headerBlock}
        {rangeSelector}
        <div
          data-testid="analytics-error-banner"
          role="alert"
          className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
            darkMode
              ? 'bg-red-500/10 text-red-300 border border-red-500/30'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-medium">Failed to load analytics</div>
            <div className="text-xs mt-0.5 opacity-90">{state.error}</div>
          </div>
          <button
            type="button"
            onClick={handleManualRefresh}
            className={`text-xs underline ${
              darkMode ? 'text-red-200' : 'text-red-700'
            }`}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isEmpty =
    !data ||
    (data.summary.totalExecutions === 0 &&
      data.successRateOverTime.length === 0 &&
      data.avgDurationOverTime.length === 0);

  if (isEmpty) {
    return (
      <div className="p-4 space-y-3">
        {headerBlock}
        {rangeSelector}
        <div
          data-testid="analytics-empty-state"
          className={`p-8 text-center rounded-lg border ${
            darkMode
              ? 'bg-gray-800 border-gray-700 text-gray-400'
              : 'bg-white border-gray-200 text-gray-500'
          }`}
        >
          <Inbox
            className={`w-10 h-10 mx-auto mb-2 ${
              darkMode ? 'text-gray-600' : 'text-gray-300'
            }`}
          />
          <p className="text-sm">No execution data for this range</p>
          <p
            className={`text-xs mt-1 ${
              darkMode ? 'text-gray-500' : 'text-gray-400'
            }`}
          >
            Run this workflow or pick a wider window
          </p>
        </div>
      </div>
    );
  }

  const summary = data.summary;
  const successColor = '#10b981';
  const durationColor = '#3b82f6';

  return (
    <div className="p-4 space-y-4" data-testid="workflow-analytics-panel">
      {headerBlock}
      {rangeSelector}

      {/* Stat cards */}
      <div
        className="grid grid-cols-2 gap-3"
        data-testid="analytics-summary-cards"
      >
        <StatCard
          label="Total executions"
          value={String(summary.totalExecutions)}
          icon={<Activity className="w-4 h-4 text-blue-500" />}
          tone="info"
          darkMode={darkMode}
          testId="stat-total-executions"
        />
        <StatCard
          label="Success rate"
          value={`${summary.successRate.toFixed(1)}%`}
          icon={<TrendingUp className="w-4 h-4 text-green-500" />}
          tone="success"
          darkMode={darkMode}
          testId="stat-success-rate"
        />
        <StatCard
          label="Avg duration"
          value={formatDuration(summary.avgDurationMs)}
          icon={<Clock className="w-4 h-4 text-blue-500" />}
          tone="default"
          darkMode={darkMode}
          testId="stat-avg-duration"
        />
        <StatCard
          label="Failure count"
          value={String(summary.failureCount)}
          icon={<XCircle className="w-4 h-4 text-red-500" />}
          tone="error"
          darkMode={darkMode}
          testId="stat-failure-count"
        />
      </div>

      {/* Time-series charts */}
      <div
        className={`rounded-lg p-3 border ${
          darkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-white border-gray-200 shadow-sm'
        }`}
      >
        <div
          className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
            darkMode ? 'text-gray-400' : 'text-gray-500'
          }`}
        >
          Success rate over time
        </div>
        <SvgLineChart
          testId="success-rate-chart"
          points={data.successRateOverTime}
          color={successColor}
          range={range}
          yMax={successYMax}
          yLabel="100%"
          ariaLabel="Success rate over time"
          darkMode={darkMode}
        />
      </div>

      <div
        className={`rounded-lg p-3 border ${
          darkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-white border-gray-200 shadow-sm'
        }`}
      >
        <div
          className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
            darkMode ? 'text-gray-400' : 'text-gray-500'
          }`}
        >
          Avg duration over time
        </div>
        <SvgLineChart
          testId="avg-duration-chart"
          points={data.avgDurationOverTime}
          color={durationColor}
          range={range}
          yMax={durationYMax}
          yLabel={formatDuration(durationYMax)}
          ariaLabel="Average duration over time"
          darkMode={darkMode}
        />
      </div>

      {/* Failure rate by node */}
      <div
        className={`rounded-lg p-3 border ${
          darkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-white border-gray-200 shadow-sm'
        }`}
      >
        <div
          className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
            darkMode ? 'text-gray-400' : 'text-gray-500'
          }`}
        >
          Failure rate by node
        </div>
        {sortedNodes.length === 0 ? (
          <p
            className={`text-xs py-2 ${
              darkMode ? 'text-gray-500' : 'text-gray-400'
            }`}
          >
            No node failures recorded
          </p>
        ) : (
          <table
            className="w-full text-xs"
            data-testid="failure-by-node-table"
          >
            <thead>
              <tr
                className={`text-left ${
                  darkMode ? 'text-gray-400' : 'text-gray-500'
                }`}
              >
                <th className="py-1 font-medium">Node</th>
                <th className="py-1 font-medium text-right">Failures</th>
                <th className="py-1 font-medium text-right">Total</th>
                <th className="py-1 font-medium w-1/3">Rate</th>
              </tr>
            </thead>
            <tbody>
              {sortedNodes.map((node) => {
                const pct =
                  node.total > 0 ? (node.failures / node.total) * 100 : 0;
                return (
                  <tr
                    key={node.nodeId}
                    data-testid={`failure-row-${node.nodeId}`}
                    className={`border-t ${
                      darkMode ? 'border-gray-700' : 'border-gray-100'
                    }`}
                  >
                    <td
                      className={`py-1.5 truncate max-w-[160px] ${
                        darkMode ? 'text-gray-200' : 'text-gray-700'
                      }`}
                      title={node.nodeLabel || node.nodeId}
                    >
                      {node.nodeLabel || node.nodeId}
                    </td>
                    <td
                      className={`py-1.5 text-right ${
                        darkMode ? 'text-red-300' : 'text-red-600'
                      }`}
                    >
                      {node.failures}
                    </td>
                    <td
                      className={`py-1.5 text-right ${
                        darkMode ? 'text-gray-300' : 'text-gray-600'
                      }`}
                    >
                      {node.total}
                    </td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-2">
                        <div
                          className={`h-1.5 rounded-full overflow-hidden flex-1 ${
                            darkMode ? 'bg-gray-700' : 'bg-gray-100'
                          }`}
                        >
                          <div
                            data-testid={`failure-bar-${node.nodeId}`}
                            className="h-full bg-red-500 transition-all"
                            style={{
                              width: `${Math.min(100, Math.max(0, pct)).toFixed(1)}%`,
                            }}
                          />
                        </div>
                        <span
                          className={`tabular-nums w-12 text-right ${
                            darkMode ? 'text-gray-300' : 'text-gray-600'
                          }`}
                        >
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Top errors */}
      <div
        className={`rounded-lg p-3 border ${
          darkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-white border-gray-200 shadow-sm'
        }`}
      >
        <div
          className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
            darkMode ? 'text-gray-400' : 'text-gray-500'
          }`}
        >
          Top errors
        </div>
        {sortedErrors.length === 0 ? (
          <p
            className={`text-xs py-2 ${
              darkMode ? 'text-gray-500' : 'text-gray-400'
            }`}
          >
            No errors in this window
          </p>
        ) : (
          <ul data-testid="top-errors-list" className="space-y-1">
            {sortedErrors.map((entry, i) => (
              <li
                key={`${entry.error}-${i}`}
                data-testid={`top-error-${i}`}
                className={`flex items-start justify-between gap-2 p-2 rounded text-xs ${
                  darkMode
                    ? 'bg-gray-900/50 border border-gray-700'
                    : 'bg-gray-50 border border-gray-100'
                }`}
              >
                <div className="flex items-start gap-2 min-w-0">
                  <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                  <span
                    className={`break-words ${
                      darkMode ? 'text-gray-200' : 'text-gray-700'
                    }`}
                  >
                    {entry.error}
                  </span>
                </div>
                <span
                  data-testid={`top-error-count-${i}`}
                  className={`flex-shrink-0 px-1.5 py-0.5 rounded font-medium tabular-nums ${
                    darkMode
                      ? 'bg-red-500/20 text-red-300'
                      : 'bg-red-50 text-red-700'
                  }`}
                >
                  {entry.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default WorkflowAnalyticsPanel;
