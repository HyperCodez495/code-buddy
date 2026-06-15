/**
 * EditorModals Component
 * Renders all lazy-loaded modal components for the workflow editor
 */

import React, { Suspense, lazy } from 'react';
import { MarkerType, useReactFlow } from '@xyflow/react';
import { WorkflowNode } from '../../../../types/workflow';
import { useWorkflowStore } from '../../../../store/workflowStore';
import { notificationService } from '../../../../services/NotificationService';
import FocusTrapWrapper from '../../../ui/FocusTrapWrapper';

// Lazy-loaded modal components
// AI Builder NL → workflow. The new `AIWorkflowBuilderModal` wires to
// `/api/ai-builder/generate` (RAG-backed catalog + validation + healing)
// instead of the legacy frontend-only `AIWorkflowBuilderService`.
const AIWorkflowBuilder = lazy(() => import('../../../ai/AIWorkflowBuilderModal'));
const VisualFlowDesigner = lazy(() => import('../VisualFlowDesigner'));
const KeyboardShortcutsModal = lazy(() => import('../../../keyboard/KeyboardShortcutsModal'));
const TemplateGalleryPanel = lazy(() => import('../../../templates/TemplateGalleryPanel'));
const PerformanceMonitorPanel = lazy(() => import('../../../monitoring/PerformanceMonitorPanel'));
const N8nImportModal = lazy(() => import('../../../import-export/N8nImportModal'));
const CommandBar = lazy(() => import('../../../utilities/CommandBar'));
const NodeContextMenu = lazy(() => import('../../../nodes/NodeContextMenu'));
const QuickNodeSearch = lazy(() => import('../../../nodes/QuickNodeSearch'));

// Loading fallback components
const ModalLoadingFallback = ({ darkMode }: { darkMode?: boolean }) => (
  <div
    className={`fixed inset-0 z-50 flex items-center justify-center ${
      darkMode ? 'bg-gray-900/50' : 'bg-gray-100/50'
    }`}
  >
    <div
      className={`${
        darkMode ? 'bg-gray-800 text-gray-200' : 'bg-white text-gray-700'
      } rounded-lg shadow-xl p-6 flex items-center`}
    >
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mr-3"></div>
      <span>Loading component...</span>
    </div>
  </div>
);

const LoadingFallback = ({ darkMode }: { darkMode?: boolean }) => (
  <div
    className={`flex items-center justify-center p-4 ${
      darkMode ? 'text-gray-400' : 'text-gray-500'
    }`}
  >
    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-current mr-2"></div>
    <span className="text-sm">Loading...</span>
  </div>
);

export interface ContextMenuState {
  nodeId: string;
  x: number;
  y: number;
}

export interface QuickSearchPosition {
  x: number;
  y: number;
}

export interface EditorModalsProps {
  // Dark mode
  darkMode: boolean;

  // AI Builder
  aiBuilderOpen: boolean;
  setAiBuilderOpen: (open: boolean) => void;

  // Visual Designer
  visualDesignerOpen: boolean;
  setVisualDesignerOpen: (open: boolean) => void;

  // Keyboard Shortcuts
  shortcutsModalOpen: boolean;
  setShortcutsModalOpen: (open: boolean) => void;

  // Templates Gallery
  templatesGalleryOpen: boolean;
  setTemplatesGalleryOpen: (open: boolean) => void;

  // Performance Monitor
  performanceMonitorOpen: boolean;
  setPerformanceMonitorOpen: (open: boolean) => void;

  // N8n Import
  n8nImportModalOpen: boolean;
  setN8nImportModalOpen: (open: boolean) => void;

  // Command Bar
  commandBarOpen: boolean;
  setCommandBarOpen: (open: boolean) => void;

  // Context Menu
  contextMenu: ContextMenuState | null;
  setContextMenu: (menu: ContextMenuState | null) => void;

  // Quick Search
  quickSearchOpen: boolean;
  setQuickSearchOpen: (open: boolean) => void;
  quickSearchPosition: QuickSearchPosition | undefined;

  // Helpers
  getId: () => string;
  createNodeData: (
    id: string,
    nodeType: string,
    position: { x: number; y: number }
  ) => unknown;
  performAutoLayout: () => void;
}

/**
 * EditorModals - Container for all editor modal components
 * Renders modals conditionally based on open state
 */
export const EditorModals: React.FC<EditorModalsProps> = ({
  darkMode,
  aiBuilderOpen,
  setAiBuilderOpen,
  visualDesignerOpen,
  setVisualDesignerOpen,
  shortcutsModalOpen,
  setShortcutsModalOpen,
  templatesGalleryOpen,
  setTemplatesGalleryOpen,
  performanceMonitorOpen,
  setPerformanceMonitorOpen,
  n8nImportModalOpen,
  setN8nImportModalOpen,
  commandBarOpen,
  setCommandBarOpen,
  contextMenu,
  setContextMenu,
  quickSearchOpen,
  setQuickSearchOpen,
  quickSearchPosition,
  getId,
  createNodeData,
  performAutoLayout,
}) => {
  // Get store actions
  const setNodes = useWorkflowStore((state) => state.setNodes);
  const setEdges = useWorkflowStore((state) => state.setEdges);
  const setSelectedNode = useWorkflowStore((state) => state.setSelectedNode);
  const setSelectedNodes = useWorkflowStore((state) => state.setSelectedNodes);
  const addToHistory = useWorkflowStore((state) => state.addToHistory);
  const saveWorkflow = useWorkflowStore((state) => state.saveWorkflow);
  const exportWorkflow = useWorkflowStore((state) => state.exportWorkflow);
  const importWorkflow = useWorkflowStore((state) => state.importWorkflow);
  const nodes = useWorkflowStore((state) => state.nodes);
  const { setCenter: rfSetCenter } = useReactFlow();

  // Helper to add a node at a position (smart positioning relative to selected node)
  const handleAddNode = (nodeType: string, position?: { x: number; y: number }) => {
    const id = getId();
    const selectedNode = useWorkflowStore.getState().selectedNode;
    const nodePosition = position || (selectedNode
      ? { x: selectedNode.position.x + 300, y: selectedNode.position.y }
      : { x: 300 + Math.random() * 100, y: 200 + Math.random() * 100 }
    );
    const newNode: WorkflowNode = {
      id,
      type: 'custom',
      position: nodePosition,
      data: createNodeData(id, nodeType, nodePosition) as WorkflowNode['data'],
    };
    const currentNodes = useWorkflowStore.getState().nodes;
    const currentEdges = useWorkflowStore.getState().edges;
    addToHistory(currentNodes, currentEdges);
    setNodes([...currentNodes, newNode]);
    setSelectedNode(newNode);

    // Center viewport on the new node
    setTimeout(() => {
      rfSetCenter(nodePosition.x + 125, nodePosition.y + 50, { duration: 300 });
    }, 50);

    return newNode;
  };

  return (
    <>
      {/* AI Workflow Builder */}
      {aiBuilderOpen && (
        <FocusTrapWrapper active={aiBuilderOpen} onEscape={() => setAiBuilderOpen(false)}>
          <Suspense fallback={<ModalLoadingFallback darkMode={darkMode} />}>
            <AIWorkflowBuilder isOpen={aiBuilderOpen} onClose={() => setAiBuilderOpen(false)} darkMode={darkMode} />
          </Suspense>
        </FocusTrapWrapper>
      )}

      {/* Visual Flow Designer */}
      {visualDesignerOpen && (
        <FocusTrapWrapper active={visualDesignerOpen} onEscape={() => setVisualDesignerOpen(false)}>
          <Suspense fallback={<ModalLoadingFallback darkMode={darkMode} />}>
            <VisualFlowDesigner
              isOpen={visualDesignerOpen}
              onClose={() => setVisualDesignerOpen(false)}
            />
          </Suspense>
        </FocusTrapWrapper>
      )}

      {/* Keyboard Shortcuts Modal */}
      {shortcutsModalOpen && (
        <FocusTrapWrapper active={shortcutsModalOpen} onEscape={() => setShortcutsModalOpen(false)}>
          <Suspense fallback={<ModalLoadingFallback darkMode={darkMode} />}>
            <KeyboardShortcutsModal
              isOpen={shortcutsModalOpen}
              onClose={() => setShortcutsModalOpen(false)}
            />
          </Suspense>
        </FocusTrapWrapper>
      )}

      {/* Templates Gallery Panel */}
      {templatesGalleryOpen && (
        <FocusTrapWrapper active={templatesGalleryOpen} onEscape={() => setTemplatesGalleryOpen(false)}>
          <Suspense fallback={<ModalLoadingFallback darkMode={darkMode} />}>
            <TemplateGalleryPanel
              isOpen={templatesGalleryOpen}
              onClose={() => setTemplatesGalleryOpen(false)}
            />
          </Suspense>
        </FocusTrapWrapper>
      )}

      {/* Performance Monitor Panel */}
      {performanceMonitorOpen && (
        <FocusTrapWrapper active={performanceMonitorOpen} onEscape={() => setPerformanceMonitorOpen(false)}>
          <Suspense fallback={<ModalLoadingFallback darkMode={darkMode} />}>
            <PerformanceMonitorPanel
              isOpen={performanceMonitorOpen}
              onClose={() => setPerformanceMonitorOpen(false)}
            />
          </Suspense>
        </FocusTrapWrapper>
      )}

      {/* n8n Import Modal */}
      {n8nImportModalOpen && (
        <FocusTrapWrapper active={n8nImportModalOpen} onEscape={() => setN8nImportModalOpen(false)}>
          <Suspense fallback={<ModalLoadingFallback darkMode={darkMode} />}>
            <N8nImportModal
              isOpen={n8nImportModalOpen}
              onClose={() => setN8nImportModalOpen(false)}
            />
          </Suspense>
        </FocusTrapWrapper>
      )}

      {/* Command Bar (Ctrl+K) */}
      {commandBarOpen && (
        <Suspense fallback={<ModalLoadingFallback darkMode={darkMode} />}>
          <CommandBar
            isOpen={commandBarOpen}
            onClose={() => setCommandBarOpen(false)}
            onAddNode={(nodeType: string) => {
              const newNode = handleAddNode(nodeType);
              setSelectedNode(newNode);
            }}
            onSave={saveWorkflow}
            onExecute={() => window.dispatchEvent(new CustomEvent('execute-workflow'))}
            onExport={exportWorkflow}
            onImport={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.json';
              input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) {
                  await importWorkflow(file);
                }
              };
              input.click();
            }}
            onUndo={() => useWorkflowStore.getState().undo()}
            onRedo={() => useWorkflowStore.getState().redo()}
            onFitView={() => window.dispatchEvent(new CustomEvent('fit-view'))}
            onZoomIn={() => window.dispatchEvent(new CustomEvent('zoom-in'))}
            onZoomOut={() => window.dispatchEvent(new CustomEvent('zoom-out'))}
            onToggleGrid={() => window.dispatchEvent(new CustomEvent('toggle-grid'))}
            onToggleMiniMap={() => window.dispatchEvent(new CustomEvent('toggle-minimap'))}
            onToggleSidebar={() => window.dispatchEvent(new CustomEvent('toggle-sidebar'))}
            onOpenShortcuts={() => setShortcutsModalOpen(true)}
            onOpenTemplates={() => setTemplatesGalleryOpen(true)}
            onOpenAIBuilder={() => setAiBuilderOpen(true)}
            onOpenN8nImport={() => setN8nImportModalOpen(true)}
            onTidyUp={performAutoLayout}
            onToggleDarkMode={() =>
              useWorkflowStore.setState((state) => ({ darkMode: !state.darkMode }))
            }
            onAddStickyNote={() => {
              const id = getId();
              const position = { x: 200 + Math.random() * 100, y: 200 + Math.random() * 100 };
              const data = createNodeData(id, 'sticky-note', position);
              const newNote: WorkflowNode = {
                id,
                type: 'stickyNote',
                position,
                data: {
                  ...(data as WorkflowNode['data']),
                  label: 'Note',
                  content: '',
                  color: '#fef3c7',
                  config: { content: '', color: '#fef3c7' },
                },
              };
              const currentNodes = useWorkflowStore.getState().nodes;
              const currentEdges = useWorkflowStore.getState().edges;
              addToHistory(currentNodes, currentEdges);
              setNodes([...currentNodes, newNote]);
            }}
            onDeleteSelected={() => window.dispatchEvent(new CustomEvent('delete-selected'))}
            onDuplicateSelected={() => window.dispatchEvent(new CustomEvent('duplicate-selected'))}
            onSelectAll={() => setSelectedNodes(useWorkflowStore.getState().nodes.map((n) => n.id))}
            onDeselectAll={() => {
              setSelectedNode(null);
              setSelectedNodes([]);
            }}
          />
        </Suspense>
      )}

      {/* Node Context Menu (right-click) */}
      {contextMenu && (
        <Suspense fallback={<LoadingFallback darkMode={darkMode} />}>
          <NodeContextMenu
            nodeId={contextMenu.nodeId}
            position={{ x: contextMenu.x, y: contextMenu.y }}
            onClose={() => setContextMenu(null)}
            onExecuteNode={(nodeId) => {
              window.dispatchEvent(new CustomEvent('execute-node', { detail: { nodeId } }));
              setContextMenu(null);
            }}
            onDuplicateNode={(nodeId) => {
              const currentNodes = useWorkflowStore.getState().nodes;
              const currentEdges = useWorkflowStore.getState().edges;
              const nodeToDuplicate = currentNodes.find((n) => n.id === nodeId);
              if (nodeToDuplicate) {
                const newNode = {
                  ...nodeToDuplicate,
                  id: getId(),
                  position: {
                    x: nodeToDuplicate.position.x + 50,
                    y: nodeToDuplicate.position.y + 50,
                  },
                };
                addToHistory(currentNodes, currentEdges);
                setNodes([...currentNodes, newNode]);
                setSelectedNode(newNode);
              }
              setContextMenu(null);
            }}
            onDeleteNode={(nodeId) => {
              const currentNodes = useWorkflowStore.getState().nodes;
              const currentEdges = useWorkflowStore.getState().edges;
              addToHistory(currentNodes, currentEdges);
              setNodes(currentNodes.filter((n) => n.id !== nodeId));
              setEdges(currentEdges.filter((e) => e.source !== nodeId && e.target !== nodeId));
              setSelectedNode(null);
              setContextMenu(null);
            }}
            onCopyNode={(nodeId) => {
              const node = nodes.find((n) => n.id === nodeId);
              if (node) {
                navigator.clipboard.writeText(JSON.stringify(node));
                notificationService.success('Node copied to clipboard', 'Copy');
              }
              setContextMenu(null);
            }}
            onCutNode={(nodeId) => {
              const node = nodes.find((n) => n.id === nodeId);
              if (node) {
                navigator.clipboard.writeText(JSON.stringify(node));
                const currentNodes = useWorkflowStore.getState().nodes;
                const currentEdges = useWorkflowStore.getState().edges;
                addToHistory(currentNodes, currentEdges);
                setNodes(currentNodes.filter((n) => n.id !== nodeId));
                setEdges(currentEdges.filter((e) => e.source !== nodeId && e.target !== nodeId));
                notificationService.success('Node cut to clipboard', 'Cut');
              }
              setContextMenu(null);
            }}
            onPinData={(nodeId) => {
              const currentNodes = useWorkflowStore.getState().nodes;
              const node = currentNodes.find((n) => n.id === nodeId);
              const nodeName = node?.data?.label || node?.data?.type || nodeId;
              window.dispatchEvent(new CustomEvent('open-pin-data', { detail: { nodeId, nodeName } }));
              setContextMenu(null);
            }}
            onToggleDisable={(nodeId) => {
              const currentNodes = useWorkflowStore.getState().nodes;
              const node = currentNodes.find((n) => n.id === nodeId);
              if (!node) {
                setContextMenu(null);
                return;
              }

              const isCurrentlyDisabled = node.data?.disabled || false;
              const updatedNodes = currentNodes.map((n) => {
                if (n.id !== nodeId) return n;
                return {
                  ...n,
                  data: {
                    ...n.data,
                    disabled: !isCurrentlyDisabled,
                  },
                };
              });

              setNodes(updatedNodes);
              notificationService.success(
                isCurrentlyDisabled ? 'Node Enabled' : 'Node Disabled',
                `${node.data?.label || node.data?.type || 'Node'} has been ${
                  isCurrentlyDisabled ? 'enabled' : 'disabled'
                }`
              );
              setContextMenu(null);
            }}
            onOpenConfig={(nodeId) => {
              const node = nodes.find((n) => n.id === nodeId);
              if (node) {
                setSelectedNode(node);
                window.dispatchEvent(new CustomEvent('open-config'));
              }
              setContextMenu(null);
            }}
            onRenameNode={(nodeId) => {
              const currentNodes = useWorkflowStore.getState().nodes;
              const node = currentNodes.find((n) => n.id === nodeId);
              if (!node) {
                setContextMenu(null);
                return;
              }

              const currentName = node.data?.label || node.data?.type || 'Node';
              const newName = prompt('Enter new node name:', currentName);

              if (newName && newName.trim() !== '' && newName.trim() !== currentName) {
                const updatedNodes = currentNodes.map((n) => {
                  if (n.id !== nodeId) return n;
                  return {
                    ...n,
                    data: {
                      ...n.data,
                      label: newName.trim(),
                    },
                  };
                });

                setNodes(updatedNodes);
                notificationService.success('Node Renamed', `Node renamed to "${newName.trim()}"`);
              }
              setContextMenu(null);
            }}
          />
        </Suspense>
      )}

      {/* Quick Node Search */}
      {quickSearchOpen && (
        <Suspense fallback={<ModalLoadingFallback darkMode={darkMode} />}>
          <QuickNodeSearch
            isOpen={quickSearchOpen}
            onClose={() => {
              setQuickSearchOpen(false);
              localStorage.removeItem('pendingConnection');
            }}
            onAddNode={(nodeType: string, position?: { x: number; y: number }) => {
              const id = getId();
              const nodePosition = position || {
                x: 300 + Math.random() * 100,
                y: 200 + Math.random() * 100,
              };
              const newNode: WorkflowNode = {
                id,
                type: 'custom',
                position: nodePosition,
                data: createNodeData(id, nodeType, nodePosition) as WorkflowNode['data'],
              };
              const currentNodes = useWorkflowStore.getState().nodes;
              const currentEdges = useWorkflowStore.getState().edges;
              addToHistory(currentNodes, currentEdges);

              // Check for pending connection (from proximity connect)
              const pendingConnectionStr = localStorage.getItem('pendingConnection');
              const pendingEdgeSplitStr = localStorage.getItem('pendingEdgeSplit');
              let newEdges = currentEdges;

              if (pendingEdgeSplitStr) {
                try {
                  const split = JSON.parse(pendingEdgeSplitStr) as {
                    edgeId: string;
                    source: string;
                    target: string;
                    sourceHandle?: string | null;
                    targetHandle?: string | null;
                  };
                  const remaining = currentEdges.filter((e) => e.id !== split.edgeId);
                  const ts = Date.now();
                  newEdges = [
                    ...remaining,
                    {
                      id: `edge_${ts}_a`,
                      source: split.source,
                      sourceHandle: split.sourceHandle ?? undefined,
                      target: id,
                      animated: true,
                      style: { stroke: '#22c55e', strokeWidth: 2 },
                      markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e', width: 16, height: 16 },
                    },
                    {
                      id: `edge_${ts}_b`,
                      source: id,
                      target: split.target,
                      targetHandle: split.targetHandle ?? undefined,
                      animated: true,
                      style: { stroke: '#22c55e', strokeWidth: 2 },
                      markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e', width: 16, height: 16 },
                    },
                  ];
                  notificationService.success('Node inserted on connection', 'Insert on Edge');
                } catch {
                  // Ignore parsing error
                }
                localStorage.removeItem('pendingEdgeSplit');
              } else if (pendingConnectionStr) {
                try {
                  const pendingConnection = JSON.parse(pendingConnectionStr);
                  const newEdge = {
                    id: `edge_${Date.now()}`,
                    source: pendingConnection.nodeId,
                    sourceHandle: pendingConnection.handleId,
                    target: id,
                    animated: true,
                    style: { stroke: '#22c55e', strokeWidth: 2 },
                    markerEnd: {
                      type: MarkerType.ArrowClosed,
                      color: '#22c55e',
                      width: 16,
                      height: 16,
                    },
                  };
                  newEdges = [...currentEdges, newEdge];
                  notificationService.success('Node added and connected', 'Quick Connect');
                } catch {
                  // Ignore parsing error
                }
                localStorage.removeItem('pendingConnection');
              }

              setNodes([...currentNodes, newNode]);
              setEdges(newEdges);
              setSelectedNode(newNode);
            }}
            position={quickSearchPosition}
          />
        </Suspense>
      )}
    </>
  );
};

export default EditorModals;
