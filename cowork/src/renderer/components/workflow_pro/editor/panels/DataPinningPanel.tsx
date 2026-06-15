/**
 * Data Pinning Panel
 * Allows users to pin test data to nodes for debugging and development
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useWorkflowStore } from '../../../../store/workflowStore';
import {
  Pin,
  PinOff,
  Upload,
  Download,
  Copy,
  Check,
  AlertCircle,
  FileJson,
  Play,
  X,
} from 'lucide-react';

interface PinnedData {
  nodeId: string;
  data: unknown;
  timestamp: number;
  source: 'manual' | 'execution' | 'import';
}

interface DataPinningPanelProps {
  isOpen: boolean;
  onClose: () => void;
  selectedNodeId?: string;
}

const DataPinningPanelComponent: React.FC<DataPinningPanelProps> = ({
  isOpen,
  onClose,
  selectedNodeId,
}) => {
  const nodes = useWorkflowStore((state) => state.nodes);
  const darkMode = useWorkflowStore((state) => state.darkMode);
  const executionResults = useWorkflowStore((state) => state.executionResults);

  const [pinnedData, setPinnedData] = useState<Map<string, PinnedData>>(new Map());
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Get node by ID
  const getNodeById = useCallback(
    (nodeId: string) => nodes.find((n) => n.id === nodeId),
    [nodes]
  );

  // Pin data to a node
  const pinData = useCallback(
    (nodeId: string, data: unknown, source: PinnedData['source'] = 'manual') => {
      setPinnedData((prev) => {
        const newMap = new Map(prev);
        newMap.set(nodeId, {
          nodeId,
          data,
          timestamp: Date.now(),
          source,
        });
        return newMap;
      });
      setError(null);
    },
    []
  );

  // Unpin data from a node
  const unpinData = useCallback((nodeId: string) => {
    setPinnedData((prev) => {
      const newMap = new Map(prev);
      newMap.delete(nodeId);
      return newMap;
    });
  }, []);

  // Pin data from last execution
  const pinFromExecution = useCallback(
    (nodeId: string) => {
      const result = executionResults[nodeId];
      if (result) {
        pinData(nodeId, result, 'execution');
      }
    },
    [executionResults, pinData]
  );

  // Start editing pinned data
  const startEditing = useCallback(
    (nodeId: string) => {
      const existing = pinnedData.get(nodeId);
      setEditingNodeId(nodeId);
      setEditValue(existing ? JSON.stringify(existing.data, null, 2) : '{\n  \n}');
      setError(null);
    },
    [pinnedData]
  );

  // Save edited data
  const saveEdit = useCallback(() => {
    if (!editingNodeId) return;

    try {
      const parsed = JSON.parse(editValue);
      pinData(editingNodeId, parsed, 'manual');
      setEditingNodeId(null);
      setEditValue('');
    } catch (_e) {
      setError('Invalid JSON format');
    }
  }, [editingNodeId, editValue, pinData]);

  // Cancel editing
  const cancelEdit = useCallback(() => {
    setEditingNodeId(null);
    setEditValue('');
    setError(null);
  }, []);

  // Copy pinned data to clipboard with error handling
  const copyToClipboard = useCallback(async (nodeId: string) => {
    const data = pinnedData.get(nodeId);
    if (data) {
      try {
        await navigator.clipboard.writeText(JSON.stringify(data.data, null, 2));
        setCopied(nodeId);
        const timeoutId = setTimeout(() => setCopied(null), 2000);
        // Store timeout for potential cleanup (component is typically mounted for duration)
        return () => clearTimeout(timeoutId);
      } catch (err) {
        console.error('Failed to copy to clipboard:', err);
        setError('Failed to copy to clipboard. Please try again.');
      }
    }
  }, [pinnedData]);

  // Export all pinned data
  const exportPinnedData = useCallback(() => {
    const exportData = Object.fromEntries(pinnedData);
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pinned-data.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [pinnedData]);

  // Import pinned data
  const importPinnedData = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          const text = await file.text();
          const imported = JSON.parse(text);
          const newMap = new Map<string, PinnedData>();
          Object.entries(imported).forEach(([key, value]) => {
            newMap.set(key, value as PinnedData);
          });
          setPinnedData(newMap);
        } catch (_e) {
          setError('Failed to import pinned data');
        }
      }
    };
    input.click();
  }, []);

  // Nodes with pinned data
  const pinnedNodes = useMemo(() => {
    return nodes.filter((n) => pinnedData.has(n.id));
  }, [nodes, pinnedData]);

  // Nodes with execution results that can be pinned
  const nodesWithResults = useMemo(() => {
    return nodes.filter(
      (n) => executionResults[n.id] && !pinnedData.has(n.id)
    );
  }, [nodes, executionResults, pinnedData]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed right-4 top-20 w-96 max-h-[calc(100vh-6rem)] overflow-hidden rounded-xl shadow-2xl border z-50 flex flex-col ${
        darkMode
          ? 'bg-gray-900 border-gray-700 text-white'
          : 'bg-white border-gray-200 text-gray-900'
      }`}
    >
      {/* Header */}
      <div
        className={`p-4 border-b flex items-center justify-between ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2">
          <Pin className="w-5 h-5 text-purple-500" />
          <h3 className="font-semibold">Data Pinning</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={importPinnedData}
            className={`p-1.5 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
            }`}
            title="Import pinned data"
          >
            <Upload className="w-4 h-4" />
          </button>
          <button
            onClick={exportPinnedData}
            className={`p-1.5 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
            }`}
            title="Export pinned data"
            disabled={pinnedData.size === 0}
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Error message */}
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-red-500 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Editing mode */}
        {editingNodeId && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Editing: {getNodeById(editingNodeId)?.data?.label || editingNodeId}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={cancelEdit}
                  className={`px-2 py-1 text-xs rounded ${
                    darkMode ? 'bg-gray-800' : 'bg-gray-100'
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  className="px-2 py-1 text-xs rounded bg-purple-500 text-white"
                >
                  Save
                </button>
              </div>
            </div>
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className={`w-full h-48 p-3 rounded-lg font-mono text-sm resize-none ${
                darkMode
                  ? 'bg-gray-800 border-gray-700'
                  : 'bg-gray-50 border-gray-200'
              } border`}
              placeholder='{"key": "value"}'
            />
          </div>
        )}

        {/* Pinned nodes */}
        {!editingNodeId && pinnedNodes.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-gray-500">Pinned Nodes</h4>
            {pinnedNodes.map((node) => {
              const data = pinnedData.get(node.id)!;
              return (
                <div
                  key={node.id}
                  className={`p-3 rounded-lg border ${
                    darkMode
                      ? 'bg-gray-800 border-gray-700'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Pin className="w-4 h-4 text-purple-500" />
                      <span className="font-medium text-sm">
                        {node.data?.label || node.id}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => copyToClipboard(node.id)}
                        className={`p-1 rounded transition-colors ${
                          darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'
                        }`}
                        title="Copy"
                      >
                        {copied === node.id ? (
                          <Check className="w-3.5 h-3.5 text-green-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => startEditing(node.id)}
                        className={`p-1 rounded transition-colors ${
                          darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'
                        }`}
                        title="Edit"
                      >
                        <FileJson className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => unpinData(node.id)}
                        className={`p-1 rounded transition-colors ${
                          darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'
                        }`}
                        title="Unpin"
                      >
                        <PinOff className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  </div>
                  <pre
                    className={`text-xs overflow-auto max-h-24 p-2 rounded ${
                      darkMode ? 'bg-gray-900' : 'bg-white'
                    }`}
                  >
                    {JSON.stringify(data.data, null, 2).slice(0, 200)}
                    {JSON.stringify(data.data).length > 200 && '...'}
                  </pre>
                  <div className="mt-2 text-xs text-gray-500">
                    Source: {data.source} | {new Date(data.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Available from execution */}
        {!editingNodeId && nodesWithResults.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-gray-500">
              Available from Last Execution
            </h4>
            {nodesWithResults.map((node) => (
              <div
                key={node.id}
                className={`p-3 rounded-lg border flex items-center justify-between ${
                  darkMode
                    ? 'bg-gray-800/50 border-gray-700'
                    : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Play className="w-4 h-4 text-green-500" />
                  <span className="text-sm">{node.data?.label || node.id}</span>
                </div>
                <button
                  onClick={() => pinFromExecution(node.id)}
                  className="px-2 py-1 text-xs rounded bg-purple-500 text-white flex items-center gap-1"
                >
                  <Pin className="w-3 h-3" />
                  Pin
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Quick pin for selected node */}
        {!editingNodeId && selectedNodeId && !pinnedData.has(selectedNodeId) && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-gray-500">Selected Node</h4>
            <div
              className={`p-3 rounded-lg border ${
                darkMode
                  ? 'bg-purple-500/10 border-purple-500/30'
                  : 'bg-purple-50 border-purple-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {getNodeById(selectedNodeId)?.data?.label || selectedNodeId}
                </span>
                <button
                  onClick={() => startEditing(selectedNodeId)}
                  className="px-3 py-1.5 text-xs rounded bg-purple-500 text-white flex items-center gap-1"
                >
                  <Pin className="w-3 h-3" />
                  Pin Test Data
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!editingNodeId &&
          pinnedNodes.length === 0 &&
          nodesWithResults.length === 0 &&
          !selectedNodeId && (
            <div className="text-center py-8">
              <Pin className="w-12 h-12 mx-auto mb-3 text-gray-400" />
              <p className="text-gray-500 text-sm">
                No pinned data yet.
                <br />
                Select a node and pin test data for debugging.
              </p>
            </div>
          )}
      </div>

      {/* Footer */}
      <div
        className={`p-3 border-t text-xs text-gray-500 ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        Pinned data will be used during execution instead of live data.
      </div>
    </div>
  );
};

const DataPinningPanel = React.memo(DataPinningPanelComponent, (prev, next) => {
  return prev.isOpen === next.isOpen && prev.selectedNodeId === next.selectedNodeId;
});

export default DataPinningPanel;
