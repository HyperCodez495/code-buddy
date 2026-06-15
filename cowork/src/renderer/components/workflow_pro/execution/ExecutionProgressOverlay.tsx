/**
 * Execution Progress Overlay
 * Shows real-time execution progress with animated connections
 */

import React, { useMemo } from 'react';
import { Activity, CheckCircle, XCircle, Clock, Zap } from 'lucide-react';
import { useWorkflowStore } from '../../../store/workflowStore';

interface ExecutionProgressOverlayProps {
  isVisible: boolean;
}

const ExecutionProgressOverlay: React.FC<ExecutionProgressOverlayProps> = ({ isVisible }) => {
  const {
    isExecuting,
    nodeExecutionStatus,
    _executionResults,
    _executionErrors,
    currentExecutingNode,
    nodes,
  } = useWorkflowStore();

  // Calculate execution statistics
  const stats = useMemo(() => {
    const total = nodes.length;
    const completed = Object.values(nodeExecutionStatus).filter(s => s === 'success').length;
    const failed = Object.values(nodeExecutionStatus).filter(s => s === 'error').length;
    const running = Object.values(nodeExecutionStatus).filter(s => s === 'running').length;
    const pending = total - completed - failed - running;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, failed, running, pending, progress };
  }, [nodes, nodeExecutionStatus]);

  // Get current executing node info
  const currentNode = useMemo(() => {
    if (!currentExecutingNode) return null;
    return nodes.find(n => n.id === currentExecutingNode);
  }, [currentExecutingNode, nodes]);

  if (!isVisible || !isExecuting) return null;

  return (
    <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 z-40 animate-in slide-in-from-bottom duration-300">
      <div className="bg-slate-900 rounded-xl shadow-2xl border border-slate-700 px-6 py-4 min-w-[400px]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            <span className="text-white font-medium">Executing Workflow</span>
          </div>
          <span className="text-slate-400 text-sm">{stats.progress}% complete</span>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300 ease-out"
            style={{ width: `${stats.progress}%` }}
          />
        </div>

        {/* Current Node */}
        {currentNode && (
          <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg mb-4">
            <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center">
              <Activity className="w-4 h-4 text-blue-400 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">
                {currentNode.data?.label || currentNode.data?.type}
              </p>
              <p className="text-slate-400 text-xs">Running...</p>
            </div>
            <div className="flex-shrink-0">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="p-2 bg-slate-800/50 rounded-lg">
            <div className="flex items-center justify-center gap-1 text-slate-400 mb-1">
              <Clock size={12} />
            </div>
            <p className="text-white font-bold text-lg">{stats.pending}</p>
            <p className="text-slate-500 text-xs">Pending</p>
          </div>
          <div className="p-2 bg-blue-500/10 rounded-lg">
            <div className="flex items-center justify-center gap-1 text-blue-400 mb-1">
              <Zap size={12} />
            </div>
            <p className="text-blue-400 font-bold text-lg">{stats.running}</p>
            <p className="text-slate-500 text-xs">Running</p>
          </div>
          <div className="p-2 bg-green-500/10 rounded-lg">
            <div className="flex items-center justify-center gap-1 text-green-400 mb-1">
              <CheckCircle size={12} />
            </div>
            <p className="text-green-400 font-bold text-lg">{stats.completed}</p>
            <p className="text-slate-500 text-xs">Success</p>
          </div>
          <div className="p-2 bg-red-500/10 rounded-lg">
            <div className="flex items-center justify-center gap-1 text-red-400 mb-1">
              <XCircle size={12} />
            </div>
            <p className="text-red-400 font-bold text-lg">{stats.failed}</p>
            <p className="text-slate-500 text-xs">Failed</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExecutionProgressOverlay;
