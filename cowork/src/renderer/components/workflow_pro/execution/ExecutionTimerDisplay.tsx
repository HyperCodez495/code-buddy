/**
 * Execution Timer Display
 * Real-time execution timer with progress tracking (like n8n)
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  CheckCircle,
  XCircle,
  Clock,
  Activity,
  TrendingUp,
  AlertTriangle,
  BarChart3,
} from 'lucide-react';
import { useWorkflowStore } from '../../../store/workflowStore';

interface ExecutionTimerDisplayProps {
  compact?: boolean;
  showHistory?: boolean;
  position?: 'header' | 'floating' | 'sidebar';
}

interface ExecutionHistoryItem {
  id: string;
  startTime: Date;
  endTime?: Date;
  duration: number;
  status: 'success' | 'error' | 'running' | 'cancelled';
  nodesExecuted: number;
  nodesTotal: number;
}

const ExecutionTimerDisplay: React.FC<ExecutionTimerDisplayProps> = ({
  compact = false,
  showHistory = true,
  position = 'header',
}) => {
  const {
    isExecuting,
    executionStartTime,
    nodes,
    nodeExecutionStatus,
  } = useWorkflowStore();

  const [elapsedTime, setElapsedTime] = useState(0);
  const [estimatedRemaining, setEstimatedRemaining] = useState<number | null>(null);
  const [executionHistory, _setExecutionHistory] = useState<ExecutionHistoryItem[]>([]);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);

  // Calculate execution progress
  const progress = useMemo(() => {
    const totalNodes = nodes.length;
    if (totalNodes === 0) return { completed: 0, running: 0, pending: 0, error: 0, percent: 0 };

    let completed = 0;
    let running = 0;
    let error = 0;

    Object.values(nodeExecutionStatus).forEach(status => {
      if (status === 'success') completed++;
      else if (status === 'running') running++;
      else if (status === 'error') error++;
    });

    const pending = totalNodes - completed - running - error;
    const percent = Math.round((completed / totalNodes) * 100);

    return { completed, running, pending, error, percent, total: totalNodes };
  }, [nodes, nodeExecutionStatus]);

  // Format time display
  const formatTime = useCallback((ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${seconds}.${Math.floor((ms % 1000) / 100)}s`;
  }, []);

  // Update elapsed time
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isExecuting && executionStartTime) {
      interval = setInterval(() => {
        const elapsed = Date.now() - executionStartTime;
        setElapsedTime(elapsed);

        // Estimate remaining time based on progress
        if (progress.percent > 0 && progress.percent < 100) {
          const timePerPercent = elapsed / progress.percent;
          const remaining = timePerPercent * (100 - progress.percent);
          setEstimatedRemaining(remaining);
        }
      }, 100);
    } else {
      setEstimatedRemaining(null);
    }

    return () => clearInterval(interval);
  }, [isExecuting, executionStartTime, progress.percent]);

  // Get average execution time from history
  const averageTime = useMemo(() => {
    const successfulRuns = executionHistory.filter(h => h.status === 'success');
    if (successfulRuns.length === 0) return null;
    const total = successfulRuns.reduce((acc, h) => acc + h.duration, 0);
    return total / successfulRuns.length;
  }, [executionHistory]);

  // Get status color
  const getStatusColor = () => {
    if (!isExecuting) return 'text-gray-500';
    if (progress.error > 0) return 'text-red-500';
    if (progress.running > 0) return 'text-blue-500';
    return 'text-green-500';
  };

  // Get status icon
  const getStatusIcon = () => {
    if (!isExecuting) {
      return <Clock size={16} className="text-gray-400" />;
    }
    if (progress.error > 0) {
      return <AlertTriangle size={16} className="text-red-500" />;
    }
    return <Activity size={16} className="text-blue-500 animate-pulse" />;
  };

  // Compact display for header
  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${isExecuting ? 'animate-in fade-in' : ''}`}>
        {isExecuting ? (
          <>
            <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-50 rounded-lg">
              <Activity size={14} className="text-blue-500 animate-pulse" />
              <span className="text-sm font-mono text-blue-700 font-medium">
                {formatTime(elapsedTime)}
              </span>
            </div>
            <div className="h-1.5 w-16 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <span className="text-xs text-gray-500">{progress.percent}%</span>
          </>
        ) : (
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Clock size={12} />
            {averageTime ? `Avg: ${formatTime(averageTime)}` : 'Ready'}
          </span>
        )}
      </div>
    );
  }

  // Full display
  return (
    <div className={`bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden ${
      position === 'floating' ? 'fixed bottom-4 right-4 w-80 z-40' : ''
    }`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b border-gray-100 flex items-center justify-between ${
        isExecuting ? 'bg-gradient-to-r from-blue-50 to-cyan-50' : 'bg-gray-50'
      }`}>
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <span className="font-semibold text-gray-900">
            {isExecuting ? 'Executing...' : 'Execution Timer'}
          </span>
        </div>
        {showHistory && executionHistory.length > 0 && (
          <button
            onClick={() => setShowHistoryPanel(!showHistoryPanel)}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <BarChart3 size={12} />
            History
          </button>
        )}
      </div>

      {/* Main timer display */}
      <div className="p-4">
        <div className="text-center mb-4">
          <div className={`text-4xl font-mono font-bold ${getStatusColor()}`}>
            {formatTime(elapsedTime)}
          </div>
          {estimatedRemaining && isExecuting && (
            <p className="text-sm text-gray-500 mt-1">
              ~{formatTime(estimatedRemaining)} remaining
            </p>
          )}
        </div>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>Progress</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                progress.error > 0 ? 'bg-red-500' : 'bg-blue-500'
              }`}
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>

        {/* Node stats */}
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center p-2 bg-green-50 rounded-lg">
            <CheckCircle size={16} className="mx-auto text-green-500 mb-1" />
            <p className="text-lg font-semibold text-green-700">{progress.completed}</p>
            <p className="text-xs text-green-600">Done</p>
          </div>
          <div className="text-center p-2 bg-blue-50 rounded-lg">
            <Activity size={16} className="mx-auto text-blue-500 mb-1" />
            <p className="text-lg font-semibold text-blue-700">{progress.running}</p>
            <p className="text-xs text-blue-600">Running</p>
          </div>
          <div className="text-center p-2 bg-gray-50 rounded-lg">
            <Clock size={16} className="mx-auto text-gray-400 mb-1" />
            <p className="text-lg font-semibold text-gray-600">{progress.pending}</p>
            <p className="text-xs text-gray-500">Pending</p>
          </div>
          <div className="text-center p-2 bg-red-50 rounded-lg">
            <XCircle size={16} className="mx-auto text-red-500 mb-1" />
            <p className="text-lg font-semibold text-red-700">{progress.error}</p>
            <p className="text-xs text-red-600">Error</p>
          </div>
        </div>

        {/* Average time comparison */}
        {averageTime && isExecuting && (
          <div className="mt-4 p-3 bg-gray-50 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <TrendingUp size={14} />
              <span>vs Average</span>
            </div>
            <span className={`text-sm font-medium ${
              elapsedTime > averageTime ? 'text-amber-600' : 'text-green-600'
            }`}>
              {elapsedTime > averageTime
                ? `+${formatTime(elapsedTime - averageTime)}`
                : `-${formatTime(averageTime - elapsedTime)}`
              }
            </span>
          </div>
        )}
      </div>

      {/* History panel */}
      {showHistoryPanel && executionHistory.length > 0 && (
        <div className="border-t border-gray-200 max-h-48 overflow-y-auto">
          <div className="p-2">
            <p className="text-xs font-medium text-gray-500 px-2 py-1">Recent Executions</p>
            {executionHistory.slice(0, 5).map(item => (
              <div
                key={item.id}
                className="flex items-center gap-3 px-2 py-2 hover:bg-gray-50 rounded-lg"
              >
                {item.status === 'success' ? (
                  <CheckCircle size={14} className="text-green-500" />
                ) : item.status === 'error' ? (
                  <XCircle size={14} className="text-red-500" />
                ) : (
                  <Activity size={14} className="text-blue-500" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500">
                    {item.startTime.toLocaleTimeString()}
                  </p>
                </div>
                <span className="text-xs font-mono text-gray-600">
                  {formatTime(item.duration)}
                </span>
                <span className="text-xs text-gray-400">
                  {item.nodesExecuted}/{item.nodesTotal}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 flex items-center justify-between text-xs text-gray-500">
        <span>
          {progress.total} nodes total
        </span>
        {averageTime && (
          <span>Avg: {formatTime(averageTime)}</span>
        )}
      </div>
    </div>
  );
};

export default ExecutionTimerDisplay;
