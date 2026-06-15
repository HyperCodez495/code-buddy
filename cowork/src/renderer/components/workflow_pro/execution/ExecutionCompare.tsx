/**
 * Execution Compare Component
 * Compare two workflow executions side by side (like n8n)
 */

import React, { useState, useMemo } from 'react';
import {
  GitCompare,
  X,
  CheckCircle,
  XCircle,
  Clock,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Diff,
  Calendar,
  Timer,
} from 'lucide-react';
import { useWorkflowStore } from '../../../store/workflowStore';

interface Execution {
  id: string;
  timestamp: number;
  status: 'success' | 'error' | 'running';
  duration?: number;
  nodeResults: Record<string, { status: string; data: unknown; error?: string }>;
}

interface ExecutionCompareProps {
  isOpen: boolean;
  onClose: () => void;
}

const ExecutionCompare: React.FC<ExecutionCompareProps> = ({ isOpen, onClose }) => {
  const { executionHistory, nodes } = useWorkflowStore();
  const [leftExecutionId, setLeftExecutionId] = useState<string | null>(null);
  const [rightExecutionId, setRightExecutionId] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // Get executions list
  const executions: Execution[] = useMemo(() => {
    return (executionHistory || []).map((exec, index) => {
      // Convert timestamp string to number if needed
      const timestamp = typeof exec.timestamp === 'string'
        ? new Date(exec.timestamp).getTime()
        : (exec.timestamp as number) || Date.now() - index * 60000;

      // Extract nodeResults from exec (it may be on a different property or need to be constructed)
      const nodeResults = (exec as any).nodeResults || {};

      return {
        id: `exec_${index}`,
        timestamp,
        status: exec.status as 'success' | 'error' | 'running',
        duration: exec.duration,
        nodeResults,
      };
    });
  }, [executionHistory]);

  // Get selected executions
  const leftExecution = executions.find(e => e.id === leftExecutionId);
  const rightExecution = executions.find(e => e.id === rightExecutionId);

  // Compare node results
  const comparison = useMemo(() => {
    if (!leftExecution || !rightExecution) return [];

    return nodes.map(node => {
      const leftResult = leftExecution.nodeResults[node.id];
      const rightResult = rightExecution.nodeResults[node.id];

      let status: 'same' | 'different' | 'added' | 'removed' = 'same';
      if (!leftResult && rightResult) status = 'added';
      else if (leftResult && !rightResult) status = 'removed';
      else if (leftResult && rightResult) {
        if (JSON.stringify(leftResult) !== JSON.stringify(rightResult)) {
          status = 'different';
        }
      }

      return {
        nodeId: node.id,
        nodeName: node.data?.label || node.data?.type || 'Unknown',
        status,
        leftResult,
        rightResult,
      };
    });
  }, [leftExecution, rightExecution, nodes]);

  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getStatusIcon = (status: 'success' | 'error' | 'running' | undefined) => {
    switch (status) {
      case 'success':
        return <CheckCircle size={14} className="text-green-500" />;
      case 'error':
        return <XCircle size={14} className="text-red-500" />;
      case 'running':
        return <Clock size={14} className="text-blue-500 animate-spin" />;
      default:
        return <Clock size={14} className="text-gray-300" />;
    }
  };

  const getDiffColor = (status: 'same' | 'different' | 'added' | 'removed') => {
    switch (status) {
      case 'different':
        return 'bg-amber-50 border-amber-200';
      case 'added':
        return 'bg-green-50 border-green-200';
      case 'removed':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-white border-gray-200';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-5xl mx-4 bg-white rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-3">
            <GitCompare size={24} className="text-blue-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Compare Executions</h2>
              <p className="text-sm text-gray-500">Select two executions to compare</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Execution selectors */}
        <div className="grid grid-cols-2 gap-4 p-4 border-b border-gray-200 bg-gray-50/50">
          {/* Left execution */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Base Execution
            </label>
            <select
              value={leftExecutionId || ''}
              onChange={(e) => setLeftExecutionId(e.target.value || null)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select execution...</option>
              {executions.map(exec => (
                <option key={exec.id} value={exec.id}>
                  {formatDate(exec.timestamp)} - {exec.status}
                </option>
              ))}
            </select>
          </div>

          {/* Right execution */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Compare With
            </label>
            <select
              value={rightExecutionId || ''}
              onChange={(e) => setRightExecutionId(e.target.value || null)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select execution...</option>
              {executions.map(exec => (
                <option key={exec.id} value={exec.id} disabled={exec.id === leftExecutionId}>
                  {formatDate(exec.timestamp)} - {exec.status}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Comparison stats */}
        {leftExecution && rightExecution && (
          <div className="grid grid-cols-2 gap-4 p-4 border-b border-gray-200">
            {/* Left stats */}
            <div className="flex items-center gap-4 text-sm">
              {getStatusIcon(leftExecution.status)}
              <span className="flex items-center gap-1">
                <Calendar size={14} className="text-gray-400" />
                {formatDate(leftExecution.timestamp)}
              </span>
              <span className="flex items-center gap-1">
                <Timer size={14} className="text-gray-400" />
                {formatDuration(leftExecution.duration)}
              </span>
            </div>
            {/* Right stats */}
            <div className="flex items-center gap-4 text-sm">
              {getStatusIcon(rightExecution.status)}
              <span className="flex items-center gap-1">
                <Calendar size={14} className="text-gray-400" />
                {formatDate(rightExecution.timestamp)}
              </span>
              <span className="flex items-center gap-1">
                <Timer size={14} className="text-gray-400" />
                {formatDuration(rightExecution.duration)}
              </span>
            </div>
          </div>
        )}

        {/* Comparison results */}
        <div className="flex-1 overflow-y-auto p-4">
          {!leftExecution || !rightExecution ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <Diff size={48} className="mb-2 opacity-50" />
              <p>Select two executions to compare</p>
            </div>
          ) : (
            <div className="space-y-2">
              {comparison.map((item) => (
                <div
                  key={item.nodeId}
                  className={`border rounded-lg overflow-hidden ${getDiffColor(item.status)}`}
                >
                  <button
                    onClick={() => toggleNode(item.nodeId)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-black/5 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {expandedNodes.has(item.nodeId) ? (
                        <ChevronDown size={16} className="text-gray-400" />
                      ) : (
                        <ChevronRight size={16} className="text-gray-400" />
                      )}
                      <span className="font-medium text-gray-900">{item.nodeName}</span>
                      {item.status !== 'same' && (
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                          item.status === 'different'
                            ? 'bg-amber-100 text-amber-700'
                            : item.status === 'added'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {item.status}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        {getStatusIcon(item.leftResult?.status as any)}
                      </span>
                      <ArrowRight size={14} />
                      <span className="flex items-center gap-1">
                        {getStatusIcon(item.rightResult?.status as any)}
                      </span>
                    </div>
                  </button>

                  {/* Expanded data comparison */}
                  {expandedNodes.has(item.nodeId) && (
                    <div className="grid grid-cols-2 gap-4 px-4 pb-4">
                      <div className="bg-white rounded-lg p-3 border border-gray-200">
                        <p className="text-xs font-medium text-gray-500 mb-2">Base</p>
                        <pre className="text-xs text-gray-700 overflow-auto max-h-40 font-mono">
                          {item.leftResult
                            ? JSON.stringify(item.leftResult.data, null, 2)
                            : 'No data'}
                        </pre>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-gray-200">
                        <p className="text-xs font-medium text-gray-500 mb-2">Compare</p>
                        <pre className="text-xs text-gray-700 overflow-auto max-h-40 font-mono">
                          {item.rightResult
                            ? JSON.stringify(item.rightResult.data, null, 2)
                            : 'No data'}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer summary */}
        {leftExecution && rightExecution && (
          <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 text-sm">
            <div className="flex items-center gap-4">
              <span className="text-gray-600">
                {comparison.filter(c => c.status === 'same').length} identical
              </span>
              <span className="text-amber-600">
                {comparison.filter(c => c.status === 'different').length} different
              </span>
              <span className="text-green-600">
                {comparison.filter(c => c.status === 'added').length} added
              </span>
              <span className="text-red-600">
                {comparison.filter(c => c.status === 'removed').length} removed
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExecutionCompare;
