/**
 * Execution Timeline
 * Visual timeline showing node execution order and timing (like n8n)
 */

import React, { useMemo } from 'react';
import { Clock, CheckCircle, XCircle, AlertCircle, Play, ChevronRight, Timer, Zap } from 'lucide-react';
import { useWorkflowStore } from '../../../store/workflowStore';

interface ExecutionTimelineProps {
  isOpen: boolean;
  onClose: () => void;
  onNodeClick: (nodeId: string) => void;
}

interface TimelineEvent {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  startTime?: number;
  endTime?: number;
  duration?: number;
  error?: string;
  outputCount?: number;
}

const ExecutionTimeline: React.FC<ExecutionTimelineProps> = ({
  isOpen,
  onClose,
  onNodeClick,
}) => {
  const {
    nodes,
    nodeExecutionStatus,
    executionResults,
    executionErrors,
    isExecuting,
  } = useWorkflowStore();

  // Track execution start time (not available in store, using current time as fallback)
  const executionStartTime = React.useMemo(() => {
    if (isExecuting) {
      return Date.now();
    }
    return null;
  }, [isExecuting]);

  // Build timeline events from execution state
  const timelineEvents: TimelineEvent[] = useMemo(() => {
    return nodes.map(node => {
      const status = nodeExecutionStatus[node.id] || 'pending';
      const result = executionResults?.[node.id];
      const error = executionErrors?.[node.id];

      let outputCount = 0;
      if (result) {
        outputCount = Array.isArray(result) ? result.length : 1;
      }

      // Extract error message safely
      let errorMessage: string | undefined;
      if (error) {
        if (typeof error === 'string') {
          errorMessage = error;
        } else if (error && typeof error === 'object' && 'message' in error) {
          errorMessage = String((error as { message: unknown }).message);
        } else {
          errorMessage = String(error);
        }
      }

      return {
        nodeId: node.id,
        nodeName: node.data?.label || node.data?.type || 'Unknown',
        nodeType: node.data?.type || 'unknown',
        status: status as TimelineEvent['status'],
        error: errorMessage,
        outputCount,
      };
    });
  }, [nodes, nodeExecutionStatus, executionResults, executionErrors]);

  // Calculate execution statistics
  const stats = useMemo(() => {
    const total = timelineEvents.length;
    const completed = timelineEvents.filter(e => e.status === 'success').length;
    const failed = timelineEvents.filter(e => e.status === 'error').length;
    const running = timelineEvents.filter(e => e.status === 'running').length;
    const pending = timelineEvents.filter(e => e.status === 'pending').length;
    const skipped = timelineEvents.filter(e => e.status === 'skipped').length;

    return { total, completed, failed, running, pending, skipped };
  }, [timelineEvents]);

  // Format duration
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  const getStatusIcon = (status: TimelineEvent['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle size={16} className="text-green-500" />;
      case 'error':
        return <XCircle size={16} className="text-red-500" />;
      case 'running':
        return (
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        );
      case 'skipped':
        return <AlertCircle size={16} className="text-gray-400" />;
      default:
        return <Clock size={16} className="text-gray-300" />;
    }
  };

  const _getStatusColor = (status: TimelineEvent['status']) => {
    switch (status) {
      case 'success': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      case 'running': return 'bg-blue-500 animate-pulse';
      case 'skipped': return 'bg-gray-300';
      default: return 'bg-gray-200';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-16 bottom-8 w-80 bg-white shadow-2xl border-l border-gray-200 z-40 flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          <Timer size={18} className="text-blue-600" />
          <h3 className="font-semibold text-gray-900">Execution Timeline</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <ChevronRight size={18} className="text-gray-500" />
        </button>
      </div>

      {/* Stats bar */}
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              {stats.completed}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              {stats.failed}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              {stats.running}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-gray-300" />
              {stats.pending}
            </span>
          </div>
          {isExecuting && (
            <span className="text-blue-600 font-medium flex items-center gap-1">
              <Play size={12} /> Running...
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full flex">
            <div
              className="bg-green-500 transition-all duration-300"
              style={{ width: `${(stats.completed / stats.total) * 100}%` }}
            />
            <div
              className="bg-red-500 transition-all duration-300"
              style={{ width: `${(stats.failed / stats.total) * 100}%` }}
            />
            <div
              className="bg-blue-500 animate-pulse transition-all duration-300"
              style={{ width: `${(stats.running / stats.total) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto">
        {timelineEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <Zap size={48} className="mb-2 opacity-50" />
            <p className="text-sm">No nodes to execute</p>
          </div>
        ) : (
          <div className="relative py-4">
            {/* Timeline line */}
            <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200" />

            {timelineEvents.map((event, index) => (
              <div
                key={event.nodeId}
                onClick={() => onNodeClick(event.nodeId)}
                className={`
                  relative flex items-start gap-3 px-4 py-3 cursor-pointer
                  hover:bg-gray-50 transition-colors
                  ${event.status === 'running' ? 'bg-blue-50' : ''}
                  ${event.status === 'error' ? 'bg-red-50' : ''}
                `}
              >
                {/* Status indicator */}
                <div className={`
                  relative z-10 w-5 h-5 rounded-full flex items-center justify-center
                  ${event.status === 'pending' ? 'bg-white border-2 border-gray-200' : 'bg-white'}
                `}>
                  {getStatusIcon(event.status)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-gray-900 truncate">
                      {event.nodeName}
                    </h4>
                    {event.duration && (
                      <span className="text-xs text-gray-500">
                        {formatDuration(event.duration)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">
                    {event.nodeType}
                  </p>
                  {event.status === 'success' && event.outputCount > 0 && (
                    <span className="inline-flex items-center gap-1 mt-1 text-xs text-green-600 bg-green-100 px-1.5 py-0.5 rounded">
                      {event.outputCount} item{event.outputCount > 1 ? 's' : ''}
                    </span>
                  )}
                  {event.status === 'error' && event.error && (
                    <p className="mt-1 text-xs text-red-600 bg-red-100 px-2 py-1 rounded truncate">
                      {event.error}
                    </p>
                  )}
                </div>

                {/* Order indicator */}
                <span className="text-xs text-gray-400 font-mono">
                  #{index + 1}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
        <div className="flex items-center justify-between">
          <span>{stats.total} nodes total</span>
          {executionStartTime && (
            <span>Started {new Date(executionStartTime).toLocaleTimeString()}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExecutionTimeline;
