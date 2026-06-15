/**
 * ExecutionWaterfall
 *
 * Horizontal bar chart showing execution timing per node.
 * Color-coded by status. Clickable bars to navigate to nodes.
 */

import React, { useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useWorkflowStore } from '../../../store/workflowStore';
import { CheckCircle, AlertTriangle, Loader2, Clock } from 'lucide-react';

interface ExecutionWaterfallProps {
  className?: string;
}

const ExecutionWaterfall: React.FC<ExecutionWaterfallProps> = ({ className = '' }) => {
  const nodes = useWorkflowStore((s) => s.nodes);
  const nodeExecutionStatus = useWorkflowStore((s) => s.nodeExecutionStatus);
  const nodeExecutionTiming = useWorkflowStore((s) => s.nodeExecutionTiming);
  const darkMode = useWorkflowStore((s) => s.darkMode);
  const { setCenter } = useReactFlow();

  const entries = useMemo(() => {
    const items = nodes
      .filter((n) => nodeExecutionTiming[n.id])
      .map((n) => ({
        id: n.id,
        label: n.data?.label || n.data?.type || n.id,
        status: nodeExecutionStatus[n.id] || 'idle',
        timing: nodeExecutionTiming[n.id],
        position: n.position,
      }))
      .sort((a, b) => (a.timing.startTime || 0) - (b.timing.startTime || 0));

    if (items.length === 0) return { items: [], minTime: 0, maxTime: 1, totalDuration: 1 };

    const minTime = Math.min(...items.map((i) => i.timing.startTime || 0));
    const maxTime = Math.max(...items.map((i) => i.timing.endTime || i.timing.startTime || 0));
    const totalDuration = Math.max(maxTime - minTime, 1);

    return { items, minTime, maxTime, totalDuration };
  }, [nodes, nodeExecutionStatus, nodeExecutionTiming]);

  const handleBarClick = (nodeId: string, position: { x: number; y: number }) => {
    setCenter(position.x + 125, position.y + 50, { duration: 400, zoom: 1.2 });
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'running': return darkMode ? 'bg-blue-600' : 'bg-blue-500';
      case 'success': return darkMode ? 'bg-green-600' : 'bg-green-500';
      case 'error': return darkMode ? 'bg-red-600' : 'bg-red-500';
      case 'skipped': return darkMode ? 'bg-gray-600' : 'bg-gray-400';
      default: return darkMode ? 'bg-gray-700' : 'bg-gray-300';
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'running': return <Loader2 className="w-3 h-3 animate-spin" />;
      case 'success': return <CheckCircle className="w-3 h-3" />;
      case 'error': return <AlertTriangle className="w-3 h-3" />;
      default: return <Clock className="w-3 h-3" />;
    }
  };

  if (entries.items.length === 0) {
    return (
      <div className={`p-4 text-center text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} ${className}`}>
        Run a workflow to see the execution timeline
      </div>
    );
  }

  const bg = darkMode ? 'bg-gray-900' : 'bg-white';
  const border = darkMode ? 'border-gray-700' : 'border-gray-200';
  const textMuted = darkMode ? 'text-gray-400' : 'text-gray-500';

  return (
    <div className={`${bg} ${className}`}>
      <div className={`px-4 py-2 border-b ${border} flex items-center justify-between`}>
        <span className="text-xs font-semibold uppercase tracking-wider">Execution Timeline</span>
        <span className={`text-xs ${textMuted}`}>
          {Math.round(entries.totalDuration)}ms total
        </span>
      </div>

      <div className="p-3 space-y-1.5 max-h-[300px] overflow-auto">
        {entries.items.map((entry) => {
          const start = ((entry.timing.startTime || 0) - entries.minTime) / entries.totalDuration;
          // Freeze the displayed duration once the node leaves 'running'.
          // Previously the `||` fallback re-computed `Date.now() - startTime`
          // every render, so even completed nodes with duration=0 (instant
          // executors) kept growing visually — and bars snapped back when the
          // engine wrote the final stored duration. Trust the stored value
          // for any non-running status.
          const isLive = entry.status === 'running' && (entry.timing.startTime || 0) > 0;
          const duration = isLive
            ? Math.max(Date.now() - (entry.timing.startTime || 0), 0)
            : (entry.timing.duration ?? 0);
          const width = Math.max(duration / entries.totalDuration, 0.02); // min 2%

          return (
            <div
              key={entry.id}
              className="flex items-center gap-2 cursor-pointer group"
              onClick={() => handleBarClick(entry.id, entry.position)}
              title={`${entry.label}: ${Math.round(duration)}ms`}
            >
              <div className={`w-24 flex-shrink-0 flex items-center gap-1.5 text-xs truncate ${textMuted} group-hover:text-blue-500 transition-colors`}>
                {statusIcon(entry.status)}
                <span className="truncate">{entry.label}</span>
              </div>
              <div className="flex-1 h-5 relative rounded overflow-hidden bg-gray-100 dark:bg-gray-800">
                <div
                  className={`absolute top-0 h-full rounded ${statusColor(entry.status)} transition-all duration-300 group-hover:opacity-80`}
                  style={{
                    left: `${start * 100}%`,
                    width: `${width * 100}%`,
                    minWidth: '4px',
                  }}
                />
              </div>
              <span className={`w-14 text-right text-xs tabular-nums ${textMuted} flex-shrink-0`}>
                {Math.round(duration)}ms
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ExecutionWaterfall;
