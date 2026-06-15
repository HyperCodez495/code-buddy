/**
 * Execution Diff Panel
 * Side-by-side comparison of two workflow executions with highlighted differences
 */

import React, { useMemo } from 'react';
import { GitCompare, Clock, CheckCircle, XCircle, ArrowRight } from 'lucide-react';

interface NodeResult {
  output: unknown;
  duration: number;
  status: string;
}

export interface ExecutionRecord {
  id: string;
  timestamp: string;
  status: string;
  duration: number;
  nodeResults: Record<string, NodeResult>;
}

interface ExecutionDiffPanelProps {
  executionA: ExecutionRecord;
  executionB: ExecutionRecord;
  onClose: () => void;
}

type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged';

function getDiffStatus(a: NodeResult | undefined, b: NodeResult | undefined): DiffStatus {
  if (!a && b) return 'added';
  if (a && !b) return 'removed';
  if (a && b && JSON.stringify(a.output) !== JSON.stringify(b.output)) return 'changed';
  return 'unchanged';
}

const diffColors: Record<DiffStatus, string> = {
  added: 'border-l-4 border-green-500 bg-green-500/10',
  removed: 'border-l-4 border-red-500 bg-red-500/10',
  changed: 'border-l-4 border-yellow-500 bg-yellow-500/10',
  unchanged: 'border-l-4 border-transparent',
};

const StatusIcon: React.FC<{ status: string }> = ({ status }) =>
  status === 'success'
    ? <CheckCircle size={14} className="text-green-500" />
    : <XCircle size={14} className="text-red-500" />;

const ExecutionDiffPanel: React.FC<ExecutionDiffPanelProps> = ({ executionA, executionB, onClose }) => {
  const allNodeIds = useMemo(() => {
    const ids = new Set([
      ...Object.keys(executionA.nodeResults),
      ...Object.keys(executionB.nodeResults),
    ]);
    return Array.from(ids).sort();
  }, [executionA, executionB]);

  const summary = useMemo(() => {
    const nodesA = Object.keys(executionA.nodeResults).length;
    const nodesB = Object.keys(executionB.nodeResults).length;
    const errorsA = Object.values(executionA.nodeResults).filter(r => r.status === 'error').length;
    const errorsB = Object.values(executionB.nodeResults).filter(r => r.status === 'error').length;
    return {
      durationDiff: executionB.duration - executionA.duration,
      nodesDiff: nodesB - nodesA,
      errorsDiff: errorsB - errorsA,
    };
  }, [executionA, executionB]);

  const formatDiff = (val: number, unit: string) =>
    val === 0 ? `0${unit}` : `${val > 0 ? '+' : ''}${val}${unit}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <GitCompare size={18} />
            <span className="font-semibold text-sm">Execution Diff</span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span>{executionA.id}</span>
            <ArrowRight size={14} />
            <span>{executionB.id}</span>
          </div>
          <button onClick={onClose} className="text-sm hover:opacity-70">&times;</button>
        </div>

        {/* Summary stats */}
        <div className="flex gap-6 px-4 py-2 text-xs border-b" style={{ borderColor: 'var(--border)' }}>
          <span className="flex items-center gap-1"><Clock size={12} /> Duration: {formatDiff(summary.durationDiff, 'ms')}</span>
          <span>Nodes executed: {formatDiff(summary.nodesDiff, '')}</span>
          <span>Errors: {formatDiff(summary.errorsDiff, '')}</span>
        </div>

        {/* Timestamps */}
        <div className="grid grid-cols-2 gap-2 px-4 py-2 text-xs opacity-70 border-b" style={{ borderColor: 'var(--border)' }}>
          <span>A: {new Date(executionA.timestamp).toLocaleString()}</span>
          <span>B: {new Date(executionB.timestamp).toLocaleString()}</span>
        </div>

        {/* Node diffs */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
          {allNodeIds.map(nodeId => {
            const a = executionA.nodeResults[nodeId];
            const b = executionB.nodeResults[nodeId];
            const diff = getDiffStatus(a, b);
            return (
              <div key={nodeId} className={`rounded p-3 ${diffColors[diff]}`} style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between text-xs font-medium mb-1">
                  <span>{nodeId}</span>
                  <span className="capitalize opacity-60">{diff}</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    {a ? (
                      <>
                        <div className="flex items-center gap-1 mb-1"><StatusIcon status={a.status} />{a.duration}ms</div>
                        <pre className="overflow-auto max-h-24 text-[11px] opacity-80">{JSON.stringify(a.output, null, 2)}</pre>
                      </>
                    ) : <span className="opacity-40">Not executed</span>}
                  </div>
                  <div>
                    {b ? (
                      <>
                        <div className="flex items-center gap-1 mb-1"><StatusIcon status={b.status} />{b.duration}ms</div>
                        <pre className="overflow-auto max-h-24 text-[11px] opacity-80">{JSON.stringify(b.output, null, 2)}</pre>
                      </>
                    ) : <span className="opacity-40">Not executed</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {allNodeIds.length === 0 && <p className="text-center text-xs opacity-50 py-8">No node results to compare</p>}
        </div>
      </div>
    </div>
  );
};

export default ExecutionDiffPanel;
