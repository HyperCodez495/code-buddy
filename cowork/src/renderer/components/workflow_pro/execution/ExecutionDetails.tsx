/**
 * Execution Details Component
 * Displays detailed information about a workflow execution
 * PROJET SAUVÉ - Phase 5.3: Execution History & Logs
 */

import React, { useState, useEffect } from 'react';
import { getExecutionRetriever } from '../../../execution/ExecutionRetriever';
import { logger } from '../../../services/SimpleLogger';
import type {
  WorkflowExecution,
  NodeExecution,
  ExecutionLog,
  ExecutionTimelineEvent
} from '../../../types/execution';

interface ExecutionDetailsProps {
  executionId: string;
  onClose?: () => void;
}

export const ExecutionDetails: React.FC<ExecutionDetailsProps> = ({
  executionId,
  onClose
}) => {
  const [execution, setExecution] = useState<WorkflowExecution | null>(null);
  const [timeline, setTimeline] = useState<ExecutionTimelineEvent[]>([]);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [selectedTab, setSelectedTab] = useState<'overview' | 'nodes' | 'logs' | 'timeline'>('overview');
  const [selectedNode, setSelectedNode] = useState<NodeExecution | null>(null);
  const [loading, setLoading] = useState(true);

  const retriever = getExecutionRetriever();

  /**
   * Load execution details
   */
  useEffect(() => {
    const loadDetails = async () => {
      setLoading(true);
      try {
        const [exec, tl, lg] = await Promise.all([
          retriever.getExecutionDetails(executionId),
          retriever.getExecutionTimeline(executionId),
          retriever.getExecutionLogs(executionId)
        ]);

        setExecution(exec);
        setTimeline(tl);
        setLogs(lg);
      } catch (error) {
        logger.error('Failed to load execution details:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDetails();
  }, [executionId, retriever]);

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
   * Get status color
   */
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'success': return 'text-green-600';
      case 'error': return 'text-red-600';
      case 'running': return 'text-blue-600';
      case 'cancelled': return 'text-gray-600';
      default: return 'text-gray-600';
    }
  };

  /**
   * Get log level color
   */
  const getLogLevelColor = (level: string): string => {
    switch (level) {
      case 'error': return 'text-red-600 bg-red-50';
      case 'warn': return 'text-yellow-600 bg-yellow-50';
      case 'info': return 'text-blue-600 bg-blue-50';
      case 'debug': return 'text-gray-600 bg-gray-50';
      case 'fatal': return 'text-red-800 bg-red-100';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  if (loading) {
    return (
      <div className="execution-details p-4">
        <div className="text-center py-8">Loading execution details...</div>
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="execution-details p-4">
        <div className="text-center py-8 text-red-600">Execution not found</div>
      </div>
    );
  }

  return (
    <div className="execution-details p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold">{execution.workflowName}</h2>
          <p className="text-sm text-gray-600">Execution ID: {execution.id}</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
          >
            Close
          </button>
        )}
      </div>

      {/* Status Card */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-sm text-gray-600 mb-1">Status</div>
            <div className={`font-semibold ${getStatusColor(execution.status)}`}>
              {execution.status.toUpperCase()}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">Duration</div>
            <div className="font-semibold">
              {execution.duration ? formatDuration(execution.duration) : 'N/A'}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">Mode</div>
            <div className="font-semibold">{execution.mode}</div>
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">Triggered By</div>
            <div className="font-semibold">{execution.triggeredBy || 'System'}</div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-600">Started:</span>{' '}
              {execution.startedAt.toLocaleString()}
            </div>
            {execution.finishedAt && (
              <div>
                <span className="text-gray-600">Finished:</span>{' '}
                {execution.finishedAt.toLocaleString()}
              </div>
            )}
            <div>
              <span className="text-gray-600">Nodes:</span>{' '}
              {execution.nodeExecutions.length}
            </div>
          </div>
        </div>

        {execution.error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
            <div className="font-semibold text-red-800 mb-1">Error</div>
            <div className="text-sm text-red-700">{execution.error.message}</div>
            {execution.error.nodeId && (
              <div className="text-xs text-red-600 mt-1">
                Failed at node: {execution.error.nodeName}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-4">
        <div className="flex gap-4">
          {(['overview', 'nodes', 'logs', 'timeline'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab)}
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                selectedTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {/* Overview Tab */}
        {selectedTab === 'overview' && (
          <div className="space-y-4">
            {execution.input && Object.keys(execution.input).length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Input Data</h3>
                <pre className="bg-gray-50 p-3 rounded text-sm overflow-x-auto">
                  {JSON.stringify(execution.input, null, 2)}
                </pre>
              </div>
            )}

            {execution.output && Object.keys(execution.output).length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Output Data</h3>
                <pre className="bg-gray-50 p-3 rounded text-sm overflow-x-auto">
                  {JSON.stringify(execution.output, null, 2)}
                </pre>
              </div>
            )}

            {execution.metadata && Object.keys(execution.metadata).length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Metadata</h3>
                <pre className="bg-gray-50 p-3 rounded text-sm overflow-x-auto">
                  {JSON.stringify(execution.metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Nodes Tab */}
        {selectedTab === 'nodes' && (
          <div className="space-y-2">
            {execution.nodeExecutions.map((nodeExec) => (
              <div
                key={nodeExec.id}
                onClick={() => setSelectedNode(selectedNode?.id === nodeExec.id ? null : nodeExec)}
                className="border border-gray-200 rounded-md p-3 hover:border-blue-500 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{nodeExec.nodeName}</span>
                      <span className="text-xs text-gray-600">({nodeExec.nodeType})</span>
                      <span className={`text-xs font-medium ${getStatusColor(nodeExec.status)}`}>
                        {nodeExec.status}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      Duration: {nodeExec.duration ? formatDuration(nodeExec.duration) : 'N/A'}
                      {nodeExec.retryCount > 0 && (
                        <span className="ml-2">• Retries: {nodeExec.retryCount}</span>
                      )}
                    </div>
                  </div>
                </div>

                {selectedNode?.id === nodeExec.id && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    {nodeExec.input && (
                      <div className="mb-3">
                        <div className="text-sm font-medium mb-1">Input:</div>
                        <pre className="bg-gray-50 p-2 rounded text-xs overflow-x-auto">
                          {JSON.stringify(nodeExec.input, null, 2)}
                        </pre>
                      </div>
                    )}
                    {nodeExec.output && (
                      <div className="mb-3">
                        <div className="text-sm font-medium mb-1">Output:</div>
                        <pre className="bg-gray-50 p-2 rounded text-xs overflow-x-auto">
                          {JSON.stringify(nodeExec.output, null, 2)}
                        </pre>
                      </div>
                    )}
                    {nodeExec.error && (
                      <div className="p-2 bg-red-50 rounded text-sm">
                        <div className="font-medium text-red-800">Error:</div>
                        <div className="text-red-700">{nodeExec.error.message}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Logs Tab */}
        {selectedTab === 'logs' && (
          <div className="space-y-1">
            {logs.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No logs available</div>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className={`p-2 rounded text-sm font-mono ${getLogLevelColor(log.level)}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="font-bold text-xs">
                      [{log.level.toUpperCase()}]
                    </span>
                    <span className="text-xs text-gray-600">
                      {log.timestamp.toLocaleTimeString()}
                    </span>
                    <span className="flex-1">{log.message}</span>
                  </div>
                  {log.data && (
                    <pre className="mt-1 text-xs opacity-75 overflow-x-auto">
                      {JSON.stringify(log.data, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Timeline Tab */}
        {selectedTab === 'timeline' && (
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200"></div>
            <div className="space-y-4">
              {timeline.map((event, _index) => (
                <div key={event.id} className="relative pl-10">
                  <div className="absolute left-2 w-4 h-4 bg-white border-2 border-blue-600 rounded-full"></div>
                  <div className="bg-white border border-gray-200 rounded-md p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium">{event.message}</span>
                      <span className="text-xs text-gray-600">
                        {event.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    {event.duration && (
                      <div className="text-sm text-gray-600">
                        Duration: {formatDuration(event.duration)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
