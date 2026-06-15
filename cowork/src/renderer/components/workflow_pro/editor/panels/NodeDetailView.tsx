/**
 * Node Detail View (NDV) — 3-panel orchestrator
 *
 * Replaces the modal-only NodeRunDataInspector with n8n's signature layout:
 *
 *   ┌──────────────┬──────────────────┬──────────────┐
 *   │ INPUT panel  │ PARAMETERS panel │ OUTPUT panel │
 *   │ (upstream    │ (node config +   │ (current node│
 *   │  output)     │  expressions)    │  result)     │
 *   └──────────────┴──────────────────┴──────────────┘
 *
 * Each I/O panel can switch between JSON / Table / Schema views and the
 * Output panel surfaces the per-node Pin button + a Test Step affordance
 * wired to the backend `/api/executions/partial` endpoint (Phase 1.5).
 */

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { X, Database, ArrowRight, Code, FlaskConical } from 'lucide-react';
import { useWorkflowStore } from '../../../../store/workflowStore';
import NodePinButton from '../../../nodes/NodePinButton';
import NodeErrorDetail, { type NodeErrorPayload } from '../../../error-handling/NodeErrorDetail';
import SchemaTree from './SchemaTree';

const NodeRunDataInspector = lazy(() => import('../../../nodes/NodeRunDataInspector'));
const NodeConfigPanel = lazy(() => import('../../../nodes/NodeConfigPanel'));

export interface NodeDetailViewProps {
  nodeId: string;
  isOpen: boolean;
  onClose: () => void;
}

type IOView = 'json' | 'table' | 'schema';

/** Render a single JSON payload in one of three view modes. */
const DataPane: React.FC<{
  label: string;
  data: unknown;
  view: IOView;
  onViewChange: (v: IOView) => void;
  accentColor?: string;
  rightAdornment?: React.ReactNode;
}> = ({ label, data, view, onViewChange, accentColor = 'var(--primary)', rightAdornment }) => {
  return (
    <div className="flex flex-col h-full border-r border-[var(--border-default)] last:border-r-0 bg-[var(--bg-primary)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: accentColor }}>{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onViewChange('json')}
            className={`px-2 py-0.5 text-[10px] rounded ${view === 'json' ? 'bg-[var(--primary)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-default)]'}`}
          >
            JSON
          </button>
          <button
            type="button"
            onClick={() => onViewChange('table')}
            className={`px-2 py-0.5 text-[10px] rounded ${view === 'table' ? 'bg-[var(--primary)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-default)]'}`}
          >
            Table
          </button>
          <button
            type="button"
            onClick={() => onViewChange('schema')}
            className={`px-2 py-0.5 text-[10px] rounded ${view === 'schema' ? 'bg-[var(--primary)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-default)]'}`}
          >
            Schema
          </button>
          {rightAdornment}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-3 text-xs font-mono">
        {data === undefined || data === null ? (
          <div className="text-[var(--text-muted)] italic">No data</div>
        ) : view === 'table' ? (
          <TableView data={data} />
        ) : view === 'schema' ? (
          <SchemaView data={data} />
        ) : (
          <pre className="whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>
        )}
      </div>
    </div>
  );
};

/** Flatten the top-level array (or wrap a single object) into a HTML table. */
const TableView: React.FC<{ data: unknown }> = ({ data }) => {
  const rows = Array.isArray(data) ? data : [data];
  const cols = Array.from(
    rows.reduce<Set<string>>((acc, row) => {
      if (row && typeof row === 'object') Object.keys(row).forEach(k => acc.add(k));
      return acc;
    }, new Set<string>()),
  );
  if (cols.length === 0) {
    return <pre>{JSON.stringify(data, null, 2)}</pre>;
  }
  return (
    <table className="min-w-full text-[11px] border-collapse">
      <thead>
        <tr className="bg-[var(--bg-secondary)]">
          {cols.map(c => <th key={c} className="text-left px-2 py-1 border border-[var(--border-default)] font-semibold">{c}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {cols.map(c => {
              const v = (row as Record<string, unknown>)?.[c];
              const display = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
              return <td key={c} className="px-2 py-1 border border-[var(--border-default)] align-top">{display}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/** Compact JSON-schema-ish view — collapsible tree with Copy path / drag-to-express. */
const SchemaView: React.FC<{ data: unknown; rootPath?: string }> = ({ data, rootPath = '$json' }) => (
  <SchemaTree data={data} rootPath={rootPath} />
);

const NodeDetailView: React.FC<NodeDetailViewProps> = ({ nodeId, isOpen, onClose }) => {
  const store = useWorkflowStore();
  const node = store.nodes.find(n => n.id === nodeId);
  const inputView = useState<IOView>('json');
  const outputView = useState<IOView>('json');
  const [showLegacyInspector, setShowLegacyInspector] = useState(false);

  // Compute upstream data — the output of immediately preceding nodes.
  // When iterating, prefer the current iteration's input snapshot if recorded.
  const inputData = useMemo(() => {
    if (!node) return undefined;
    const iterInput = iterations?.[Math.min(currentIteration, (iterations?.length ?? 1) - 1)]?.input;
    if (iterInput !== undefined) return iterInput;

    const incoming = store.edges.filter(e => e.target === nodeId);
    if (incoming.length === 0) return undefined;
    if (incoming.length === 1) {
      const src = incoming[0].source;
      return store.executionResults?.[src] ?? store.pinnedData?.[src];
    }
    const acc: Record<string, unknown> = {};
    for (const e of incoming) {
      const src = store.nodes.find(n => n.id === e.source);
      const label = src?.data?.label || e.source;
      acc[label] = store.executionResults?.[e.source] ?? store.pinnedData?.[e.source];
    }
    return acc;
  }, [node, nodeId, store.edges, store.executionResults, store.nodes, store.pinnedData, iterations, currentIteration]);

  const rawOutputResult = store.executionResults?.[nodeId];
  const iterations = (rawOutputResult as { iterations?: Array<{ index: number; input?: unknown; output?: unknown }> } | undefined)?.iterations;
  const iterationCount = iterations?.length ?? 0;
  const [currentIteration, setCurrentIteration] = useState(0);

  // Reset iteration cursor when the node changes or new iterations arrive.
  useEffect(() => {
    if (iterationCount > 0) setCurrentIteration(iterationCount - 1);
  }, [nodeId, iterationCount]);

  const outputData = useMemo(() => {
    if (iterations && iterations.length > 0) {
      const idx = Math.min(currentIteration, iterations.length - 1);
      return iterations[idx]?.output;
    }
    return rawOutputResult ?? store.pinnedData?.[nodeId];
  }, [iterations, currentIteration, rawOutputResult, store.pinnedData, nodeId]);

  /**
   * Extract a structured error payload from the current output, if any.
   * Workflow executors return a `{ error, success: false }` shape on
   * failure; the payload can be a string (legacy) or an object with
   * `message`/`stack`/`code`/`timestamp` fields. Normalize both shapes
   * into the `NodeErrorPayload` consumed by <NodeErrorDetail/>.
   */
  const errorPayload = useMemo<NodeErrorPayload | null>(() => {
    const out = outputData as Record<string, unknown> | undefined;
    if (!out || typeof out !== 'object') return null;
    const raw = out.error;
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'string') return { message: raw };
    if (typeof raw === 'object') {
      const e = raw as Record<string, unknown>;
      const message =
        typeof e.message === 'string'
          ? e.message
          : typeof e.error === 'string'
            ? (e.error as string)
            : JSON.stringify(e);
      const stack = typeof e.stack === 'string' ? e.stack : undefined;
      const code =
        typeof e.code === 'string'
          ? e.code
          : typeof e.code === 'number'
            ? String(e.code)
            : undefined;
      const timestamp = typeof e.timestamp === 'string' ? e.timestamp : undefined;
      return { message, stack, code, timestamp };
    }
    return { message: String(raw) };
  }, [outputData]);

  const retryCount = useMemo<number | undefined>(() => {
    const out = outputData as Record<string, unknown> | undefined;
    const n = out?.retryCount;
    return typeof n === 'number' ? n : undefined;
  }, [outputData]);

  const errorWorkflowId =
    typeof store.errorWorkflowId === 'string' && store.errorWorkflowId.length > 0
      ? store.errorWorkflowId
      : undefined;

  const handleOpenErrorWorkflow = useCallback((workflowId: string) => {
    if (typeof window !== 'undefined') {
      window.location.assign(`/workflows/${workflowId}`);
    }
  }, []);

  // NodeConfigPanel reads the selected node from the store — mirror our
  // local nodeId there so the params panel binds to the correct node.
  useEffect(() => {
    if (!isOpen || !node) return;
    const prev = store.selectedNode;
    store.setSelectedNode(node as never);
    return () => { store.setSelectedNode(prev as never); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, node?.id]);

  const handleTestStep = useCallback(async () => {
    const workflowId = (store as any).currentWorkflowId || (store as any).workflowId;
    if (!workflowId) return;
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
      const res = await fetch('/api/executions/partial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ workflowId, startNodeId: nodeId, stopAfterNodeId: nodeId }),
      });
      if (!res.ok) return;
      const body = await res.json() as { results?: Record<string, { data?: unknown }> };
      const result = body.results?.[nodeId];
      if (result?.data !== undefined) {
        store.setExecutionResult(nodeId, result.data as never);
      }
    } catch {
      // network errors handled by global error logger
    }
  }, [nodeId, store]);

  if (!isOpen || !node) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[95vw] h-[92vh] max-w-[1600px] bg-[var(--bg-primary)] rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-default)]">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[var(--primary)]" />
            <span className="font-semibold">{node.data?.label || node.id}</span>
            <span className="text-xs text-[var(--text-muted)]">({node.data?.type})</span>
            {iterationCount > 1 && (
              <div
                className="ml-3 flex items-center gap-1 text-xs text-[var(--text-muted)]"
                role="group"
                aria-label="Iteration switcher"
                data-testid="iteration-switcher"
              >
                <button
                  type="button"
                  onClick={() => setCurrentIteration(i => Math.max(0, i - 1))}
                  disabled={currentIteration === 0}
                  className="px-1 rounded border border-[var(--border-default)] disabled:opacity-30"
                  aria-label="Previous iteration"
                >‹</button>
                <span>Run {currentIteration + 1} of {iterationCount}</span>
                <button
                  type="button"
                  onClick={() => setCurrentIteration(i => Math.min(iterationCount - 1, i + 1))}
                  disabled={currentIteration === iterationCount - 1}
                  className="px-1 rounded border border-[var(--border-default)] disabled:opacity-30"
                  aria-label="Next iteration"
                >›</button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTestStep}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--border-default)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
              title="Run this node only (executes upstream chain via /partial)"
            >
              <FlaskConical className="w-3 h-3" /> Test step
            </button>
            <button
              type="button"
              onClick={() => setShowLegacyInspector(true)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--border-default)] hover:text-[var(--text-default)] transition-colors"
              title="Open full run data inspector"
            >
              <Code className="w-3 h-3" /> Inspect runs
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-[var(--bg-secondary)]"
              aria-label="Close detail view"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 3-panel body */}
        <div className="flex-1 grid grid-cols-[1fr_2fr_1fr] min-h-0">
          <DataPane
            label="Input"
            data={inputData}
            view={inputView[0]}
            onViewChange={inputView[1]}
            accentColor="var(--primary)"
          />
          <div className="flex flex-col h-full border-r border-[var(--border-default)] overflow-auto bg-[var(--bg-secondary)]">
            <div className="flex items-center px-3 py-2 border-b border-[var(--border-default)]">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-default)]">Parameters</span>
              <ArrowRight className="w-3 h-3 ml-auto text-[var(--text-muted)]" />
            </div>
            <div className="flex-1 overflow-auto">
              <Suspense fallback={<div className="p-3 text-xs text-[var(--text-muted)]">Loading config…</div>}>
                {/* NodeConfigPanel reads the selected node from the workflow
                    store; mounting it inside the NDV picks up `selectedNode`
                    which is already set when the detail view opens. */}
                <NodeConfigPanel onClose={onClose} />
              </Suspense>
            </div>
          </div>
          <div className="flex flex-col h-full min-h-0 bg-[var(--bg-primary)]">
            {errorPayload && (
              <div className="p-3 border-b border-[var(--border-default)] overflow-auto max-h-[45%]">
                <NodeErrorDetail
                  nodeId={nodeId}
                  error={errorPayload}
                  retryCount={retryCount}
                  errorWorkflowId={errorWorkflowId}
                  onOpenErrorWorkflow={handleOpenErrorWorkflow}
                />
              </div>
            )}
            <div className="flex-1 min-h-0">
              <DataPane
                label="Output"
                data={outputData}
                view={outputView[0]}
                onViewChange={outputView[1]}
                accentColor="#22c55e"
                rightAdornment={
                  <span className="ml-2"><NodePinButton nodeId={nodeId} dataToPin={outputData} compact /></span>
                }
              />
            </div>
          </div>
        </div>

        {/* Optional legacy inspector for deep multi-run analysis */}
        {showLegacyInspector && (
          <Suspense fallback={null}>
            <NodeRunDataInspector
              nodeId={nodeId}
              isOpen
              onClose={() => setShowLegacyInspector(false)}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
};

export default NodeDetailView;
