/**
 * NodeTestPanel — Test a single node in isolation with custom input data
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  X, Play, Loader2, CheckCircle, XCircle, Clock,
  RotateCcw, Copy, ChevronDown, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { useWorkflowStore } from '../../../../store/workflowStore';

interface NodeTestPanelProps {
  isOpen: boolean;
  onClose: () => void;
  nodeId: string | null;
}

interface TestResult {
  status: 'success' | 'error';
  success: boolean;
  data?: Record<string, unknown>;
  error?: { message: string; stack?: string; code?: string };
  duration: number;
  timestamp: string;
  timedOut?: boolean;
}

const NodeTestPanel: React.FC<NodeTestPanelProps> = ({ isOpen, onClose, nodeId }) => {
  const { nodes, edges, pinnedData, executionResults, nodeExecutionHistory } = useWorkflowStore();

  const node = useMemo(() => nodes.find(n => n.id === nodeId), [nodes, nodeId]);

  // Derive default input from upstream node results or pinned data
  const defaultInput = useMemo(() => {
    if (!nodeId) return '{}';

    // Priority 1: pinned data
    const pinned = pinnedData?.[nodeId];
    if (pinned) {
      return JSON.stringify(pinned, null, 2);
    }

    // Priority 2: upstream node execution result
    const incomingEdge = edges.find(e => e.target === nodeId);
    if (incomingEdge) {
      const upstreamResult = executionResults?.[incomingEdge.source];
      if (upstreamResult) {
        return JSON.stringify(upstreamResult, null, 2);
      }
    }

    return '{}';
  }, [nodeId, pinnedData, edges, executionResults]);

  const [inputJson, setInputJson] = useState(defaultInput);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [outputExpanded, setOutputExpanded] = useState(true);

  // Reset when node changes
  useEffect(() => {
    setInputJson(defaultInput);
    setJsonError(null);
    setTestResult(null);
  }, [nodeId, defaultInput]);

  // Validate JSON on edit
  const handleInputChange = useCallback((value: string) => {
    setInputJson(value);
    try {
      JSON.parse(value);
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }, []);

  const handleReset = useCallback(() => {
    setInputJson(defaultInput);
    setJsonError(null);
  }, [defaultInput]);

  const handleCopyResult = useCallback(() => {
    if (testResult?.data) {
      navigator.clipboard.writeText(JSON.stringify(testResult.data, null, 2));
    }
  }, [testResult]);

  // Execute the node
  const handleRunTest = useCallback(async () => {
    if (!node || jsonError) return;

    setIsRunning(true);
    setTestResult(null);

    try {
      const parsedInput = JSON.parse(inputJson);

      // Dynamic import to avoid loading the heavy ExecutionEngine upfront
      const { WorkflowExecutor } = await import('../../../../components/ExecutionEngine');
      const executor = new WorkflowExecutor([node], [], {});
      const result = await executor.executeNode(node, parsedInput);

      setTestResult(result as TestResult);

      // Update store so the canvas node shows status
      const store = useWorkflowStore.getState();
      if (result.success && result.data) {
        store.setExecutionResult(node.id, result.data);
      }
    } catch (err) {
      setTestResult({
        status: 'error',
        success: false,
        error: { message: err instanceof Error ? err.message : String(err) },
        duration: 0,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsRunning(false);
    }
  }, [node, inputJson, jsonError]);

  const nodeLabel = node?.data?.label || node?.data?.type || 'Node';
  const nodeType = node?.data?.type || 'unknown';

  const { isTriggerNode, isExternalCallNode } = useMemo(() => {
    const t = nodeType.toLowerCase();
    return {
      isTriggerNode: t.includes('trigger') || t === 'webhook' || t === 'schedule' || t === 'cron',
      isExternalCallNode: t.includes('http') || t.includes('request') || t.includes('fetch'),
    };
  }, [nodeType]);

  if (!isOpen || !nodeId || !node) return null;

  return (
    <div className="fixed right-0 top-12 bottom-0 w-[480px] bg-[var(--bg-primary)] border-l border-[var(--border-default)] shadow-xl z-[200] flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[var(--primary)]/10 flex items-center justify-center flex-shrink-0">
            <Play className="w-4 h-4 text-[var(--primary)]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
              Test: {nodeLabel}
            </h3>
            <p className="text-[11px] text-[var(--text-muted)]">{nodeType}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--linear-surface-hover)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Warnings */}
      {isTriggerNode && (
        <div className="mx-4 mt-3 flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="text-xs">Trigger nodes produce data — they don't consume input. Test results may differ from production triggers.</p>
        </div>
      )}
      {isExternalCallNode && (
        <div className="mx-4 mt-3 flex items-start gap-2 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="text-xs">This will make a real external HTTP call. Ensure credentials and endpoints are correct.</p>
        </div>
      )}

      {/* Input Section */}
      <div className="px-4 py-3 border-b border-[var(--border-default)]">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
            Input Data (JSON)
          </label>
          <button
            onClick={handleReset}
            className="flex items-center gap-1 text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--primary)] transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        </div>
        <textarea
          value={inputJson}
          onChange={e => handleInputChange(e.target.value)}
          className={`w-full h-32 px-3 py-2 text-xs font-mono rounded-lg border resize-y
            bg-[var(--bg-secondary)] text-[var(--text-primary)]
            placeholder:text-[var(--text-muted)]
            focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/20
            ${jsonError ? 'border-[var(--error)] focus:border-[var(--error)]' : 'border-[var(--border-default)] focus:border-[var(--primary)]'}
          `}
          placeholder='{ "key": "value" }'
          spellCheck={false}
        />
        {jsonError && (
          <p className="mt-1 text-[10px] text-[var(--error)] flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {jsonError}
          </p>
        )}
      </div>

      {/* Run Button */}
      <div className="px-4 py-3 border-b border-[var(--border-default)]">
        <button
          onClick={handleRunTest}
          disabled={isRunning || !!jsonError}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5
            bg-[var(--primary)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed
            text-white text-sm font-semibold rounded-lg
            transition-all duration-150 active:scale-[0.98]"
        >
          {isRunning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Run Test
            </>
          )}
        </button>
      </div>

      {/* Output Section */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!testResult && !isRunning && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Play className="w-8 h-8 text-[var(--text-muted)] mb-3 opacity-30" />
            <p className="text-sm text-[var(--text-muted)]">
              Click "Run Test" to execute this node
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-1 opacity-70">
              The node will run in isolation with the input data above
            </p>
          </div>
        )}

        {testResult && (
          <div className="space-y-3">
            {/* Status Bar */}
            <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${
              testResult.success
                ? 'bg-[var(--success)]/5 border-[var(--success)]/20'
                : 'bg-[var(--error)]/5 border-[var(--error)]/20'
            }`}>
              {testResult.success ? (
                <CheckCircle className="w-4 h-4 text-[var(--success)] flex-shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-[var(--error)] flex-shrink-0" />
              )}
              <span className={`text-sm font-semibold ${
                testResult.success ? 'text-[var(--success)]' : 'text-[var(--error)]'
              }`}>
                {testResult.success ? 'Success' : testResult.timedOut ? 'Timed Out' : 'Error'}
              </span>
              <div className="flex items-center gap-1 ml-auto text-[11px] text-[var(--text-muted)]">
                <Clock className="w-3 h-3" />
                {testResult.duration}ms
              </div>
            </div>

            {/* Error Message */}
            {testResult.error && (
              <div className="px-3 py-2.5 rounded-lg border border-[var(--error)]/20 bg-[var(--error)]/5">
                <p className="text-xs font-semibold text-[var(--error)] mb-1">
                  {testResult.error.code || 'Error'}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {testResult.error.message}
                </p>
              </div>
            )}

            {/* Output Data */}
            {testResult.data && (
              <div>
                <button
                  onClick={() => setOutputExpanded(!outputExpanded)}
                  className="flex items-center gap-2 mb-2 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider hover:text-[var(--text-primary)] transition-colors"
                >
                  {outputExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  Output Data
                  <button
                    onClick={e => { e.stopPropagation(); handleCopyResult(); }}
                    className="ml-auto p-1 rounded text-[var(--text-muted)] hover:text-[var(--primary)] transition-colors"
                    title="Copy to clipboard"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </button>
                {outputExpanded && (
                  <pre className="px-3 py-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] text-[11px] font-mono text-[var(--text-primary)] overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(testResult.data, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {/* Timestamp */}
            <p className="text-[10px] text-[var(--text-muted)] text-right">
              {new Date(testResult.timestamp).toLocaleTimeString()}
            </p>
          </div>
        )}

        {/* Per-Node Execution History */}
        {nodeId && (nodeExecutionHistory?.[nodeId]?.length ?? 0) > 0 && (
          <div className="mt-4 pt-3 border-t border-[var(--border-default)]">
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
              Execution History ({nodeExecutionHistory[nodeId].length})
            </p>
            <div className="space-y-1">
              {nodeExecutionHistory[nodeId].map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-[var(--bg-secondary)] text-[11px]"
                >
                  {entry.status === 'success' ? (
                    <CheckCircle className="w-3 h-3 text-[var(--success)] flex-shrink-0" />
                  ) : (
                    <XCircle className="w-3 h-3 text-[var(--error)] flex-shrink-0" />
                  )}
                  <span className="text-[var(--text-muted)]">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  {entry.duration != null && (
                    <span className="text-[var(--text-muted)] ml-auto">{entry.duration}ms</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NodeTestPanel;
