/**
 * Execution History Component
 * Displays workflow execution history with filtering
 * PROJET SAUVÉ - Phase 5.3: Execution History & Logs
 */

import React, { useState, useEffect, useCallback } from 'react';
import { getExecutionRetriever } from '../../../execution/ExecutionRetriever';
import { logger } from '../../../services/SimpleLogger';
import type {
  ExecutionSummary,
  ExecutionStatus,
  ExecutionFilter
} from '../../../types/execution';

interface ExecutionHistoryProps {
  workflowId?: string;
  onSelectExecution?: (executionId: string) => void;
}

export const ExecutionHistory: React.FC<ExecutionHistoryProps> = ({
  workflowId,
  onSelectExecution
}) => {
  const [executions, setExecutions] = useState<ExecutionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState<ExecutionStatus | 'all'>('all');
  const [selectedMode, setSelectedMode] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [limit, setLimit] = useState(50);

  const retriever = getExecutionRetriever();

  /**
   * Load executions
   */
  const loadExecutions = useCallback(async () => {
    setLoading(true);
    try {
      const _filter: ExecutionFilter = {
        workflowId,
        status: selectedStatus !== 'all' ? selectedStatus : undefined,
        mode: selectedMode !== 'all' ? selectedMode : undefined,
        search: searchQuery || undefined,
        limit,
        sortBy: 'startedAt',
        sortOrder: 'desc'
      };

      const result = workflowId
        ? await retriever.getWorkflowExecutions(workflowId, limit)
        : await retriever.getRecentExecutions(limit);

      setExecutions(result);
    } catch (error) {
      logger.error('Failed to load executions:', error);
    } finally {
      setLoading(false);
    }
  }, [workflowId, selectedStatus, selectedMode, searchQuery, limit, retriever]);

  /**
   * Load executions on mount and when filters change
   */
  useEffect(() => {
    loadExecutions();
  }, [loadExecutions]);

  /**
   * Get status badge color
   */
  const getStatusBadgeColor = (status: ExecutionStatus): string => {
    switch (status) {
      case 'success': return 'bg-green-100 text-green-800';
      case 'error': return 'bg-red-100 text-red-800';
      case 'running': return 'bg-blue-100 text-blue-800';
      case 'cancelled': return 'bg-gray-100 text-gray-800';
      case 'timeout': return 'bg-yellow-100 text-yellow-800';
      case 'waiting': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  /**
   * Get status icon
   */
  const getStatusIcon = (status: ExecutionStatus): string => {
    switch (status) {
      case 'success': return '✓';
      case 'error': return '✗';
      case 'running': return '⟳';
      case 'cancelled': return '⊗';
      case 'timeout': return '⏱';
      case 'waiting': return '⏸';
      default: return '?';
    }
  };

  /**
   * Format duration
   */
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  };

  /**
   * Format date
   */
  const formatDate = (date: Date): string => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // Less than 1 minute
    if (diff < 60000) {
      return 'Just now';
    }

    // Less than 1 hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes}m ago`;
    }

    // Less than 24 hours
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }

    // Less than 7 days
    if (diff < 604800000) {
      const days = Math.floor(diff / 86400000);
      return `${days}d ago`;
    }

    // Full date
    return date.toLocaleString();
  };

  return (
    <div className="execution-history p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Execution History</h2>
        <button
          onClick={loadExecutions}
          className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        {/* Status filter */}
        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value as ExecutionStatus | 'all')}
          className="px-3 py-2 border border-gray-300 rounded-md"
        >
          <option value="all">All Status</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
          <option value="running">Running</option>
          <option value="cancelled">Cancelled</option>
          <option value="timeout">Timeout</option>
          <option value="waiting">Waiting</option>
        </select>

        {/* Mode filter */}
        <select
          value={selectedMode}
          onChange={(e) => setSelectedMode(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md"
        >
          <option value="all">All Modes</option>
          <option value="manual">Manual</option>
          <option value="trigger">Trigger</option>
          <option value="webhook">Webhook</option>
          <option value="schedule">Schedule</option>
          <option value="test">Test</option>
        </select>

        {/* Search */}
        <input
          type="text"
          placeholder="Search executions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
        />

        {/* Limit */}
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="px-3 py-2 border border-gray-300 rounded-md"
        >
          <option value="10">10</option>
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </div>

      {/* Execution List */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-8 text-gray-500">
            Loading executions...
          </div>
        ) : executions.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No executions found
          </div>
        ) : (
          executions.map((execution) => (
            <div
              key={execution.id}
              onClick={() => onSelectExecution && onSelectExecution(execution.id)}
              className="border border-gray-200 rounded-md p-4 hover:border-blue-500 hover:bg-blue-50 cursor-pointer transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusBadgeColor(execution.status)}`}>
                      {getStatusIcon(execution.status)} {execution.status}
                    </span>
                    <span className="px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded">
                      {execution.mode}
                    </span>
                    <span className="font-semibold">{execution.workflowName}</span>
                  </div>

                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span>
                      ID: <code className="font-mono text-xs">{execution.id}</code>
                    </span>
                    <span>
                      Duration: {formatDuration(execution.duration)}
                    </span>
                    <span>
                      Nodes: {execution.successfulNodes}/{execution.totalNodes} successful
                      {execution.failedNodes > 0 && (
                        <span className="text-red-600 ml-1">
                          ({execution.failedNodes} failed)
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="text-xs text-gray-500 mt-2">
                    Started: {formatDate(execution.startedAt)}
                    {execution.finishedAt && (
                      <> • Finished: {formatDate(execution.finishedAt)}</>
                    )}
                  </div>
                </div>

                <div className="ml-4">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectExecution && onSelectExecution(execution.id);
                    }}
                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    View Details
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Summary */}
      {executions.length > 0 && (
        <div className="mt-4 p-4 bg-gray-50 rounded-md">
          <div className="flex items-center justify-between text-sm">
            <span>Total executions: {executions.length}</span>
            <span>
              Success rate:{' '}
              {((executions.filter(e => e.status === 'success').length / executions.length) * 100).toFixed(1)}%
            </span>
            <span>
              Avg duration:{' '}
              {formatDuration(
                executions.reduce((sum, e) => sum + e.duration, 0) / executions.length
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
