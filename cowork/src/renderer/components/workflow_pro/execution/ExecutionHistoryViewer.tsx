/**
 * Enhanced Execution History Viewer
 * Features: Timeline view, filtering, comparison, re-run, export logs
 * AGENT 5 - UI/UX IMPROVEMENTS
 */

import React, { useState, useMemo } from 'react';
import { useWorkflowStore } from '../../../store/workflowStore';
import { logger } from '../../../services/SimpleLogger';
import type { ExecutionHistory } from '../../../types/workflow';
import {
  Clock, CheckCircle, XCircle, PlayCircle, PauseCircle,
  Download, RefreshCw, Search, 
  GitCompare, ChevronDown, ChevronRight
} from 'lucide-react';

interface ExecutionHistoryItem {
  id: string;
  workflowId: string;
  timestamp: string;
  status: 'success' | 'error' | 'cancelled' | 'running';
  duration: number;
  nodes: number;
  environment: string;
  triggeredBy?: string;
  errorMessage?: string;
  nodeResults?: Record<string, any>;
  nodesExecuted: number;
  errors?: string[];
}

// Helper function to transform ExecutionHistory to ExecutionHistoryItem
const transformExecutionHistory = (history: ExecutionHistory[]): ExecutionHistoryItem[] => {
  return history.map((exec, index) => ({
    id: `exec-${index}-${exec.timestamp}`,
    workflowId: exec.workflowId,
    timestamp: exec.timestamp,
    status: exec.status as 'success' | 'error' | 'cancelled' | 'running',
    duration: exec.duration,
    nodes: exec.nodesExecuted,
    environment: exec.environment,
    triggeredBy: undefined,
    errorMessage: exec.errors && exec.errors.length > 0 ? exec.errors.join(', ') : undefined,
    nodeResults: undefined,
    nodesExecuted: exec.nodesExecuted,
    errors: exec.errors
  }));
};

export default function ExecutionHistoryViewer() {
  const {
    executionHistory,
    darkMode,
    _nodes,
    _edges,
    _setNodes,
    _setEdges,
    isExecuting
  } = useWorkflowStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date' | 'duration'>('date');
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  const [_selectedExecution, _setSelectedExecution] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareExecutions, setCompareExecutions] = useState<string[]>([]);
  const [expandedExecutions, setExpandedExecutions] = useState<Set<string>>(new Set());

  // Transform execution history to the format we need
  const transformedHistory = useMemo(() => {
    return transformExecutionHistory(executionHistory || []);
  }, [executionHistory]);

  // Filter and sort executions
  const filteredExecutions = useMemo(() => {
    let filtered = [...transformedHistory];

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(exec => exec.status === statusFilter);
    }

    // Date filter
    if (dateFilter !== 'all') {
      const now = new Date();
      const filterDate = new Date();

      switch (dateFilter) {
        case '1h':
          filterDate.setHours(now.getHours() - 1);
          break;
        case '24h':
          filterDate.setHours(now.getHours() - 24);
          break;
        case '7d':
          filterDate.setDate(now.getDate() - 7);
          break;
        case '30d':
          filterDate.setDate(now.getDate() - 30);
          break;
      }

      filtered = filtered.filter(exec =>
        new Date(exec.timestamp) >= filterDate
      );
    }

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(exec =>
        exec.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        exec.environment?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        exec.errorMessage?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === 'date') {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      } else {
        return b.duration - a.duration;
      }
    });

    return filtered;
  }, [transformedHistory, statusFilter, dateFilter, searchQuery, sortBy]);

  // Calculate statistics
  const statistics = useMemo(() => {
    const total = filteredExecutions.length;
    const successful = filteredExecutions.filter(e => e.status === 'success').length;
    const failed = filteredExecutions.filter(e => e.status === 'error').length;
    const avgDuration = total > 0
      ? filteredExecutions.reduce((sum, e) => sum + e.duration, 0) / total
      : 0;

    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      avgDuration
    };
  }, [filteredExecutions]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle size={16} className="text-green-500" />;
      case 'error':
        return <XCircle size={16} className="text-red-500" />;
      case 'running':
        return <PlayCircle size={16} className="text-blue-500 animate-pulse" />;
      case 'cancelled':
        return <PauseCircle size={16} className="text-gray-500" />;
      default:
        return <Clock size={16} className="text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'error':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'running':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatDate = (date: string | Date) => {
    const now = new Date();
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const diff = now.getTime() - dateObj.getTime();

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

    return dateObj.toLocaleString();
  };

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expandedExecutions);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedExecutions(newExpanded);
  };

  const toggleCompare = (id: string) => {
    if (compareExecutions.includes(id)) {
      setCompareExecutions(compareExecutions.filter(e => e !== id));
    } else if (compareExecutions.length < 2) {
      setCompareExecutions([...compareExecutions, id]);
    }
  };

  // Re-run the full workflow (B3#7 — manual retry from UI). The editor
  // listens for a `rerun-workflow` CustomEvent and kicks off a new run
  // via its existing execute pipeline, so this viewer does not need its
  // own engine handle.
  const handleRerun = (execution: ExecutionHistoryItem) => {
    logger.debug('Re-running execution:', execution.id);
    window.dispatchEvent(
      new CustomEvent('rerun-workflow', {
        detail: { executionId: execution.id, workflowId: execution.workflowId },
      }),
    );
  };

  // Retry from the first failed node (B3#5). Uses the editor's partial
  // execution pipeline (`execute-from-node` CustomEvent → runPartialExecution
  // downstream) so the run resumes just where it broke instead of
  // repeating everything upstream.
  const handleRetryFromFailure = (execution: ExecutionHistoryItem) => {
    if (!execution.errors || execution.errors.length === 0) return;
    // Heuristic: errors[0] is expected to contain the failing nodeId, but
    // some pipelines emit a plain message. We rely on the nodeResults map
    // when available; otherwise we dispatch a generic rerun.
    const failedNodeId = execution.nodeResults
      ? Object.entries(execution.nodeResults).find(
          ([, v]) => (v as { status?: string })?.status === 'error',
        )?.[0]
      : undefined;
    if (failedNodeId) {
      // ModernWorkflowEditor already registers a `run-downstream` handler
      // that pipes into runPartialExecution (see editor's useEffect).
      window.dispatchEvent(
        new CustomEvent('run-downstream', {
          detail: { nodeId: failedNodeId },
        }),
      );
    } else {
      // Fall back to full re-run if we can't identify the failing node.
      handleRerun(execution);
    }
  };

  const handleExportLogs = () => {
    const dataStr = JSON.stringify(filteredExecutions, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `execution-history-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`execution-history-viewer h-full flex flex-col ${
      darkMode ? 'bg-gray-900 text-gray-100' : 'bg-white text-gray-900'
    }`}>
      {/* Header */}
      <div className={`p-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Clock size={20} />
            Execution History
          </h2>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode(viewMode === 'list' ? 'timeline' : 'list')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                darkMode
                  ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
              title={`Switch to ${viewMode === 'list' ? 'timeline' : 'list'} view`}
            >
              {viewMode === 'list' ? 'Timeline' : 'List'}
            </button>

            <button
              onClick={() => setCompareMode(!compareMode)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                compareMode
                  ? 'bg-blue-600 text-white'
                  : darkMode
                    ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
              title="Compare executions"
            >
              <GitCompare size={16} />
            </button>

            <button
              onClick={handleExportLogs}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                darkMode
                  ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
              title="Export execution logs"
            >
              <Download size={16} />
            </button>
          </div>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className={`p-3 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
            <div className="text-xs opacity-60 mb-1">Total</div>
            <div className="text-2xl font-bold">{statistics.total}</div>
          </div>
          <div className={`p-3 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
            <div className="text-xs opacity-60 mb-1">Success Rate</div>
            <div className="text-2xl font-bold text-green-500">
              {statistics.successRate.toFixed(1)}%
            </div>
          </div>
          <div className={`p-3 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
            <div className="text-xs opacity-60 mb-1">Failed</div>
            <div className="text-2xl font-bold text-red-500">{statistics.failed}</div>
          </div>
          <div className={`p-3 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
            <div className="text-xs opacity-60 mb-1">Avg Duration</div>
            <div className="text-2xl font-bold">{formatDuration(statistics.avgDuration)}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
            <input
              type="text"
              placeholder="Search executions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full pl-10 pr-4 py-2 rounded-lg border ${
                darkMode
                  ? 'bg-gray-800 border-gray-700 text-gray-100'
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`px-3 py-2 rounded-lg border ${
              darkMode
                ? 'bg-gray-800 border-gray-700 text-gray-100'
                : 'bg-white border-gray-300 text-gray-900'
            }`}
          >
            <option value="all">All Status</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="running">Running</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className={`px-3 py-2 rounded-lg border ${
              darkMode
                ? 'bg-gray-800 border-gray-700 text-gray-100'
                : 'bg-white border-gray-300 text-gray-900'
            }`}
          >
            <option value="all">All Time</option>
            <option value="1h">Last Hour</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'duration')}
            className={`px-3 py-2 rounded-lg border ${
              darkMode
                ? 'bg-gray-800 border-gray-700 text-gray-100'
                : 'bg-white border-gray-300 text-gray-900'
            }`}
          >
            <option value="date">Sort by Date</option>
            <option value="duration">Sort by Duration</option>
          </select>
        </div>
      </div>

      {/* Execution List */}
      <div className="flex-1 overflow-auto p-4">
        {filteredExecutions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full opacity-60">
            <Clock size={48} className="mb-4" />
            <p className="text-lg font-medium">No executions found</p>
            <p className="text-sm">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredExecutions.map((execution) => {
              const isExpanded = expandedExecutions.has(execution.id);
              const isSelected = compareMode && compareExecutions.includes(execution.id);

              return (
                <div
                  key={execution.id}
                  className={`p-4 rounded-lg border transition-all ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : darkMode
                        ? 'border-gray-700 bg-gray-800 hover:bg-gray-750'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <button
                          onClick={() => toggleExpanded(execution.id)}
                          className="hover:bg-black/10 rounded p-1"
                        >
                          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>

                        {getStatusIcon(execution.status)}

                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
                            execution.status
                          )}`}
                        >
                          {execution.status}
                        </span>

                        <span className="font-mono text-xs opacity-60">
                          {execution.id}
                        </span>

                        <span className="text-sm opacity-60">
                          {formatDate(execution.timestamp)}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-sm ml-8">
                        <span>
                          <strong>Duration:</strong> {formatDuration(execution.duration)}
                        </span>
                        <span>
                          <strong>Nodes:</strong> {execution.nodes}
                        </span>
                        <span>
                          <strong>Environment:</strong> {execution.environment}
                        </span>
                        {execution.triggeredBy && (
                          <span>
                            <strong>Triggered by:</strong> {execution.triggeredBy}
                          </span>
                        )}
                      </div>

                      {execution.errorMessage && (
                        <div className="mt-2 ml-8 text-sm text-red-600 dark:text-red-400">
                          <strong>Error:</strong> {execution.errorMessage}
                        </div>
                      )}

                      {/* Expanded details */}
                      {isExpanded && execution.nodeResults && (
                        <div className={`mt-3 ml-8 p-3 rounded-lg ${
                          darkMode ? 'bg-gray-900' : 'bg-gray-100'
                        }`}>
                          <h4 className="text-sm font-semibold mb-2">Node Results:</h4>
                          <div className="space-y-1 text-sm font-mono">
                            {Object.entries(execution.nodeResults).map(([nodeId, result]) => (
                              <div key={nodeId} className="flex justify-between">
                                <span className="opacity-60">{nodeId}:</span>
                                <span>{JSON.stringify(result).substring(0, 50)}...</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {compareMode && (
                        <button
                          onClick={() => toggleCompare(execution.id)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            isSelected
                              ? 'bg-blue-600 text-white'
                              : darkMode
                                ? 'bg-gray-700 hover:bg-gray-600'
                                : 'bg-gray-100 hover:bg-gray-200'
                          }`}
                          disabled={!isSelected && compareExecutions.length >= 2}
                        >
                          Compare
                        </button>
                      )}

                      <button
                        onClick={() => handleRerun(execution)}
                        className={`p-2 rounded-lg transition-colors ${
                          darkMode
                            ? 'hover:bg-gray-700 text-green-400'
                            : 'hover:bg-gray-100 text-green-600'
                        }`}
                        title="Re-run execution"
                        disabled={isExecuting}
                      >
                        <RefreshCw size={16} />
                      </button>

                      {execution.status === 'error' && (
                        <button
                          onClick={() => handleRetryFromFailure(execution)}
                          className={`p-2 rounded-lg transition-colors ${
                            darkMode
                              ? 'hover:bg-gray-700 text-amber-400'
                              : 'hover:bg-gray-100 text-amber-600'
                          }`}
                          title="Retry from failed node"
                          disabled={isExecuting}
                        >
                          <PlayCircle size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Comparison panel — side-by-side meta + per-field delta */}
      {compareMode && compareExecutions.length === 2 && (() => {
        const execA = filteredExecutions.find(e => e.id === compareExecutions[0]);
        const execB = filteredExecutions.find(e => e.id === compareExecutions[1]);
        if (!execA || !execB) return null;

        // ── Per-field delta helpers ────────────────────────────────
        const durationDelta = execB.duration - execA.duration; // positive = B slower
        const errorsDeltaCount = (execB.errors?.length ?? 0) - (execA.errors?.length ?? 0);
        const nodesDelta = execB.nodesExecuted - execA.nodesExecuted;
        const statusChanged = execA.status !== execB.status;

        // Visual classes: green when B is better, red when worse, neutral otherwise.
        // For status, we treat success > error > cancelled > running.
        const STATUS_RANK: Record<string, number> = { success: 3, running: 2, cancelled: 1, error: 0 };
        const statusRankDelta = (STATUS_RANK[execB.status] ?? 0) - (STATUS_RANK[execA.status] ?? 0);
        const deltaClass = (delta: number, betterWhen: 'higher' | 'lower') => {
          if (delta === 0) return darkMode ? 'text-gray-400' : 'text-gray-500';
          const better = betterWhen === 'higher' ? delta > 0 : delta < 0;
          return better ? 'text-emerald-500' : 'text-red-500';
        };
        const fmtDelta = (delta: number, unit = '') =>
          `${delta === 0 ? '' : delta > 0 ? '+' : ''}${delta}${unit}`;
        const fmtDurationDelta = (delta: number) => {
          if (delta === 0) return '0ms';
          const abs = Math.abs(delta);
          const sign = delta > 0 ? '+' : '−';
          return abs < 1000 ? `${sign}${abs}ms` : `${sign}${(abs / 1000).toFixed(1)}s`;
        };

        return (
          <div className={`border-t p-4 ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <GitCompare size={18} />
              Comparison <span className="text-xs opacity-60">(A → B)</span>
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {[execA, execB].map((exec, idx) => (
                <div key={exec.id} className={`p-3 rounded-lg ${darkMode ? 'bg-gray-900' : 'bg-white'}`}>
                  <div className="text-xs opacity-60 mb-2 flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${idx === 0 ? 'bg-blue-500/20 text-blue-500' : 'bg-purple-500/20 text-purple-500'}`}>
                      {idx === 0 ? 'A' : 'B'}
                    </span>
                    <code>{exec.id}</code>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div><strong>Status:</strong> {exec.status}</div>
                    <div><strong>Duration:</strong> {formatDuration(exec.duration)}</div>
                    <div><strong>Nodes:</strong> {exec.nodesExecuted}</div>
                    <div><strong>Environment:</strong> {exec.environment}</div>
                    {(exec.errors?.length ?? 0) > 0 && (
                      <div className="text-red-500"><strong>Errors:</strong> {exec.errors!.length}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Delta row */}
            <div className={`mt-4 rounded-lg p-3 ${darkMode ? 'bg-gray-900' : 'bg-white'} border ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <div className="text-xs opacity-60 mb-2 font-semibold uppercase tracking-wide">Δ Delta</div>
              <div className="grid grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-xs opacity-60">Duration</div>
                  <div className={`font-mono ${deltaClass(durationDelta, 'lower')}`}>
                    {fmtDurationDelta(durationDelta)}
                  </div>
                </div>
                <div>
                  <div className="text-xs opacity-60">Nodes executed</div>
                  <div className={`font-mono ${deltaClass(nodesDelta, 'higher')}`}>
                    {fmtDelta(nodesDelta)}
                  </div>
                </div>
                <div>
                  <div className="text-xs opacity-60">Errors</div>
                  <div className={`font-mono ${deltaClass(errorsDeltaCount, 'lower')}`}>
                    {fmtDelta(errorsDeltaCount)}
                  </div>
                </div>
                <div>
                  <div className="text-xs opacity-60">Status</div>
                  <div className={`font-mono ${statusChanged ? deltaClass(statusRankDelta, 'higher') : darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {statusChanged ? `${execA.status} → ${execB.status}` : 'same'}
                  </div>
                </div>
              </div>
            </div>

            {/* Inline diff of error messages, when present in either run */}
            {(execA.errors?.length || execB.errors?.length) ? (
              <div className="mt-4 grid grid-cols-2 gap-4 text-xs font-mono">
                <pre className={`p-2 rounded ${darkMode ? 'bg-gray-900 text-red-300' : 'bg-red-50 text-red-700'} max-h-32 overflow-auto`}>
                  {execA.errors?.length ? execA.errors.join('\n') : '— no errors —'}
                </pre>
                <pre className={`p-2 rounded ${darkMode ? 'bg-gray-900 text-red-300' : 'bg-red-50 text-red-700'} max-h-32 overflow-auto`}>
                  {execB.errors?.length ? execB.errors.join('\n') : '— no errors —'}
                </pre>
              </div>
            ) : null}
          </div>
        );
      })()}
    </div>
  );
}
