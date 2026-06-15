/**
 * Execution Statistics Panel
 * Displays per-workflow execution statistics: success rate, average duration,
 * fastest/slowest execution, daily bar chart, and recent execution list.
 */

import React, { useMemo } from 'react';
import {
  BarChart3,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
  TrendingUp,
  RefreshCw,
  Activity,
} from 'lucide-react';

export interface ExecutionStatsEntry {
  id: string;
  status: 'success' | 'error' | 'running';
  startedAt: number;
  duration: number;
}

interface ExecutionStatsPanelProps {
  executionHistory: ExecutionStatsEntry[];
  darkMode: boolean;
}

/** Format milliseconds into a human-readable duration string. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/** Format a timestamp into a short date/time string. */
function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - ts;
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 24) {
    return date.toLocaleTimeString();
  } else if (diffHours < 48) {
    return `Yesterday ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Get the short weekday label for a Date. */
function getDayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short' });
}

export const ExecutionStatsPanel: React.FC<ExecutionStatsPanelProps> = ({
  executionHistory,
  darkMode,
}) => {
  const stats = useMemo(() => {
    const total = executionHistory.length;
    if (total === 0) {
      return {
        total: 0,
        successCount: 0,
        errorCount: 0,
        runningCount: 0,
        successRate: 0,
        avgDuration: 0,
        fastest: null as ExecutionStatsEntry | null,
        slowest: null as ExecutionStatsEntry | null,
        dailyCounts: [] as { label: string; total: number; success: number; error: number }[],
        recent: [] as ExecutionStatsEntry[],
      };
    }

    const successCount = executionHistory.filter((e) => e.status === 'success').length;
    const errorCount = executionHistory.filter((e) => e.status === 'error').length;
    const runningCount = executionHistory.filter((e) => e.status === 'running').length;

    // Only completed executions for duration stats
    const completed = executionHistory.filter((e) => e.status !== 'running' && e.duration > 0);
    const avgDuration = completed.length > 0
      ? completed.reduce((sum, e) => sum + e.duration, 0) / completed.length
      : 0;

    let fastest: ExecutionStatsEntry | null = null;
    let slowest: ExecutionStatsEntry | null = null;
    for (const entry of completed) {
      if (!fastest || entry.duration < fastest.duration) fastest = entry;
      if (!slowest || entry.duration > slowest.duration) slowest = entry;
    }

    const successRate = total > 0 ? (successCount / total) * 100 : 0;

    // Executions per day for last 7 days
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const dailyCounts: { label: string; total: number; success: number; error: number }[] = [];

    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i).getTime();
      const dayEnd = dayStart + dayMs;
      const dayEntries = executionHistory.filter(
        (e) => e.startedAt >= dayStart && e.startedAt < dayEnd
      );
      dailyCounts.push({
        label: getDayLabel(new Date(dayStart)),
        total: dayEntries.length,
        success: dayEntries.filter((e) => e.status === 'success').length,
        error: dayEntries.filter((e) => e.status === 'error').length,
      });
    }

    // Recent 5 sorted by startedAt descending
    const recent = [...executionHistory]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 5);

    return {
      total,
      successCount,
      errorCount,
      runningCount,
      successRate,
      avgDuration,
      fastest,
      slowest,
      dailyCounts,
      recent,
    };
  }, [executionHistory]);

  const successRateColor = stats.successRate > 80
    ? 'text-green-500'
    : stats.successRate > 50
    ? 'text-yellow-500'
    : 'text-red-500';

  const successRateBg = stats.successRate > 80
    ? darkMode ? 'bg-green-500/10' : 'bg-green-50'
    : stats.successRate > 50
    ? darkMode ? 'bg-yellow-500/10' : 'bg-yellow-50'
    : darkMode ? 'bg-red-500/10' : 'bg-red-50';

  const cardClass = `rounded-lg p-3 ${
    darkMode ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200 shadow-sm'
  }`;

  const maxDailyCount = Math.max(1, ...stats.dailyCounts.map((d) => d.total));

  const getStatusIcon = (status: ExecutionStatsEntry['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-3.5 h-3.5 text-green-500" />;
      case 'error':
        return <XCircle className="w-3.5 h-3.5 text-red-500" />;
      case 'running':
        return <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
    }
  };

  if (stats.total === 0) {
    return (
      <div className="p-6 text-center">
        <BarChart3
          className={`w-12 h-12 mx-auto mb-3 ${
            darkMode ? 'text-gray-600' : 'text-gray-300'
          }`}
        />
        <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          No execution data available
        </p>
        <p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          Run this workflow to see statistics
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-blue-500" />
        <h3 className={`font-semibold text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          Execution Statistics
        </h3>
        <span
          className={`px-2 py-0.5 text-xs rounded-full ${
            darkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {stats.total} total
        </span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        {/* Success Rate */}
        <div className={`${cardClass} ${successRateBg}`}>
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className={`w-4 h-4 ${successRateColor}`} />
            <span className={`text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Success Rate
            </span>
          </div>
          <div className={`text-2xl font-bold ${successRateColor}`}>
            {stats.successRate.toFixed(1)}%
          </div>
          <div className={`text-xs mt-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            {stats.successCount} passed / {stats.errorCount} failed
          </div>
        </div>

        {/* Avg Duration */}
        <div className={cardClass}>
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className={`w-4 h-4 ${darkMode ? 'text-blue-400' : 'text-blue-500'}`} />
            <span className={`text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Avg Duration
            </span>
          </div>
          <div className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {formatDuration(stats.avgDuration)}
          </div>
          <div className={`text-xs mt-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            per execution
          </div>
        </div>

        {/* Fastest */}
        <div className={cardClass}>
          <div className="flex items-center gap-1.5 mb-1">
            <Zap className="w-4 h-4 text-green-500" />
            <span className={`text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Fastest
            </span>
          </div>
          <div className={`text-lg font-bold ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
            {stats.fastest ? formatDuration(stats.fastest.duration) : '--'}
          </div>
        </div>

        {/* Slowest */}
        <div className={cardClass}>
          <div className="flex items-center gap-1.5 mb-1">
            <Activity className="w-4 h-4 text-orange-500" />
            <span className={`text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Slowest
            </span>
          </div>
          <div className={`text-lg font-bold ${darkMode ? 'text-orange-400' : 'text-orange-600'}`}>
            {stats.slowest ? formatDuration(stats.slowest.duration) : '--'}
          </div>
        </div>
      </div>

      {/* Running indicator */}
      {stats.runningCount > 0 && (
        <div
          className={`flex items-center gap-2 p-2 rounded-lg text-xs ${
            darkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-600'
          }`}
        >
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span>{stats.runningCount} execution{stats.runningCount > 1 ? 's' : ''} currently running</span>
        </div>
      )}

      {/* Daily Bar Chart (Last 7 Days) */}
      <div className={cardClass}>
        <div className={`text-xs font-semibold uppercase tracking-wider mb-3 ${
          darkMode ? 'text-gray-400' : 'text-gray-500'
        }`}>
          Executions per Day (Last 7 Days)
        </div>
        <div className="flex items-end gap-1.5 h-24">
          {stats.dailyCounts.map((day, i) => {
            const heightPct = (day.total / maxDailyCount) * 100;
            const errorPct = day.total > 0 ? (day.error / day.total) * 100 : 0;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className={`text-[10px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {day.total}
                </span>
                <div className="w-full flex-1 flex items-end">
                  <div
                    className="w-full rounded-t relative overflow-hidden transition-all duration-300"
                    style={{ height: `${Math.max(heightPct, day.total > 0 ? 8 : 2)}%` }}
                  >
                    {/* Success portion */}
                    <div
                      className={`absolute bottom-0 left-0 right-0 ${
                        darkMode ? 'bg-green-500/60' : 'bg-green-400'
                      }`}
                      style={{ height: '100%' }}
                    />
                    {/* Error portion overlay from top */}
                    {errorPct > 0 && (
                      <div
                        className={`absolute top-0 left-0 right-0 ${
                          darkMode ? 'bg-red-500/60' : 'bg-red-400'
                        }`}
                        style={{ height: `${errorPct}%` }}
                      />
                    )}
                  </div>
                </div>
                <span className={`text-[10px] ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  {day.label}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-2 pt-2 border-t border-dashed ${darkMode ? 'border-gray-700' : 'border-gray-200'}">
          <div className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${darkMode ? 'bg-green-500/60' : 'bg-green-400'}`} />
            <span className={`text-[10px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Success</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${darkMode ? 'bg-red-500/60' : 'bg-red-400'}`} />
            <span className={`text-[10px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Error</span>
          </div>
        </div>
      </div>

      {/* Recent Executions */}
      <div className={cardClass}>
        <div className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
          darkMode ? 'text-gray-400' : 'text-gray-500'
        }`}>
          Recent Executions
        </div>
        <div className="space-y-1.5">
          {stats.recent.map((exec) => (
            <div
              key={exec.id}
              className={`flex items-center justify-between p-2 rounded text-xs ${
                darkMode ? 'bg-gray-900/50 border border-gray-700' : 'bg-gray-50 border border-gray-100'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {getStatusIcon(exec.status)}
                <span className={`capitalize font-medium ${
                  exec.status === 'success'
                    ? 'text-green-500'
                    : exec.status === 'error'
                    ? 'text-red-500'
                    : 'text-blue-500'
                }`}>
                  {exec.status}
                </span>
                <span className={`truncate ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  {formatTimestamp(exec.startedAt)}
                </span>
              </div>
              <span className={`flex-shrink-0 px-1.5 py-0.5 rounded ${
                darkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-200 text-gray-600'
              }`}>
                {formatDuration(exec.duration)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
