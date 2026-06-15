/**
 * EditorPanels Component
 * Renders all panel components (sidebars, config panels, feature panels)
 */

import React, { Suspense, lazy } from 'react';
import { WorkflowNode } from '../../../../types/workflow';
import { useWorkflowStore } from '../../../../store/workflowStore';
import { notificationService } from '../../../../services/NotificationService';

// Import regular components
import { N8NStyleNodePanel } from '../../../nodes/N8NStyleNodePanel';
import { FocusPanel } from '../../../nodes/FocusPanel';
import {
  DataPinningPanel,
  ExecutionHistoryPanel,
  EnhancedNodeSearch,
  WorkflowVariablesPanel,
  CustomNodeCreator,
  WorkflowDocGenerator,
  CollaborationIndicators,
} from '../panels';

// Lazy-loaded components
const ExecutionProgressOverlay = lazy(
  () => import('../../execution/ExecutionProgressOverlay')
);
const DataPreviewTooltip = lazy(() => import('../../../data/DataPreviewTooltip'));
const PinDataPanel = lazy(() => import('../../../nodes/PinDataPanel'));
const EnhancedStatusBar = lazy(() => import('../../../canvas/EnhancedStatusBar'));
const BulkOperationsPanel = lazy(() => import('../../../utilities/BulkOperationsPanel'));
const StepDebugPanel = lazy(() => import('../../../debugging/StepDebugPanel'));

// Loading fallback
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

export interface DataPreviewState {
  nodeId: string;
  x: number;
  y: number;
}

export interface PinDataPanelState {
  nodeId: string;
  nodeName: string;
}

export interface N8nNodePanelPosition {
  x: number;
  y: number;
}

export interface EditorPanelsProps {
  // Dark mode
  darkMode: boolean;

  // Sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  filterCategory: string;
  setFilterCategory: (category: string) => void;

  // N8N Style
  useN8nStyle: boolean;

  // Config Panel
  configPanelOpen: boolean;
  setConfigPanelOpen: (open: boolean) => void;

  // N8N Node Panel
  n8nNodePanelOpen: boolean;
  setN8nNodePanelOpen: (open: boolean) => void;
  n8nNodePanelPosition: N8nNodePanelPosition | undefined;

  // Focus Panel
  focusPanelOpen: boolean;
  setFocusPanelOpen: (open: boolean) => void;
  focusPanelNode: WorkflowNode | null;
  setFocusPanelNode: (node: WorkflowNode | null) => void;

  // Execution
  isExecuting: boolean;

  // Data Preview
  dataPreview: DataPreviewState | null;
  setDataPreview: (preview: DataPreviewState | null) => void;

  // Pin Data Panel
  pinDataPanel: PinDataPanelState | null;
  setPinDataPanel: (panel: PinDataPanelState | null) => void;

  // Bulk Operations
  bulkPanelOpen: boolean;
  setBulkPanelOpen: (open: boolean) => void;

  // Feature Panels
  dataPinningPanelOpen: boolean;
  setDataPinningPanelOpen: (open: boolean) => void;
  executionHistoryOpen: boolean;
  setExecutionHistoryOpen: (open: boolean) => void;
  nodeSearchOpen: boolean;
  setNodeSearchOpen: (open: boolean) => void;
  variablesPanelOpen: boolean;
  setVariablesPanelOpen: (open: boolean) => void;
  customNodeCreatorOpen: boolean;
  setCustomNodeCreatorOpen: (open: boolean) => void;
  docGeneratorOpen: boolean;
  setDocGeneratorOpen: (open: boolean) => void;
  collaborationOpen: boolean;
  setCollaborationOpen: (open: boolean) => void;
  stepDebugPanelOpen: boolean;
  setStepDebugPanelOpen: (open: boolean) => void;
  setHighlightedDebugNode: (nodeId: string | null) => void;

  // Zoom controls
  zoomLevel: number;
  viewMode: 'normal' | 'compact' | 'detailed';
  zoomIn: () => void;
  zoomOut: () => void;
  zoomTo: (zoom: number) => void;
  fitView: () => void;
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;
  showMiniMap: boolean;
  setShowMiniMap: (show: boolean) => void;
  setShortcutsModalOpen: (open: boolean) => void;

  // Bulk operations handlers
  handleBulkDelete: () => void;
  handleBulkDuplicate: () => void;
  handleBulkAlign: (
    alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
  ) => void;
  handleBulkDistribute: (direction: 'horizontal' | 'vertical') => void;
  handleBulkToggleEnabled: (enabled: boolean) => void;

  // Helpers
  getId: () => string;
  createNodeData: (
    id: string,
    nodeType: string,
    position: { x: number; y: number }
  ) => unknown;
}

/**
 * EditorPanels - Container for all editor panel components
 */
export const EditorPanels: React.FC<EditorPanelsProps> = ({
  darkMode,
  _sidebarOpen,
  _setSidebarOpen,
  _searchTerm,
  _setSearchTerm,
  _filterCategory,
  _setFilterCategory,
  useN8nStyle,
  _configPanelOpen,
  setConfigPanelOpen,
  n8nNodePanelOpen,
  setN8nNodePanelOpen,
  n8nNodePanelPosition,
  focusPanelOpen,
  setFocusPanelOpen,
  focusPanelNode,
  setFocusPanelNode,
  isExecuting,
  dataPreview,
  setDataPreview,
  pinDataPanel,
  setPinDataPanel,
  bulkPanelOpen,
  setBulkPanelOpen,
  dataPinningPanelOpen,
  setDataPinningPanelOpen,
  executionHistoryOpen,
  setExecutionHistoryOpen,
  nodeSearchOpen,
  setNodeSearchOpen,
  variablesPanelOpen,
  setVariablesPanelOpen,
  customNodeCreatorOpen,
  setCustomNodeCreatorOpen,
  docGeneratorOpen,
  setDocGeneratorOpen,
  collaborationOpen,
  setCollaborationOpen,
  stepDebugPanelOpen,
  setStepDebugPanelOpen,
  setHighlightedDebugNode,
  zoomLevel,
  viewMode,
  zoomIn,
  zoomOut,
  zoomTo,
  fitView,
  showGrid,
  setShowGrid,
  showMiniMap,
  setShowMiniMap,
  setShortcutsModalOpen,
  handleBulkDelete,
  handleBulkDuplicate,
  handleBulkAlign,
  handleBulkDistribute,
  handleBulkToggleEnabled,
  getId,
  createNodeData,
}) => {
  // Get store state and actions
  const nodes = useWorkflowStore((state) => state.nodes);
  const selectedNode = useWorkflowStore((state) => state.selectedNode);
  const selectedNodes = useWorkflowStore((state) => state.selectedNodes);
  const nodeExecutionStatus = useWorkflowStore((state) => state.nodeExecutionStatus);
  const setNodes = useWorkflowStore((state) => state.setNodes);
  const setEdges = useWorkflowStore((state) => state.setEdges);
  const setSelectedNode = useWorkflowStore((state) => state.setSelectedNode);
  const addToHistory = useWorkflowStore((state) => state.addToHistory);

  return (
    <>
      {/* Config Panel - now docked in ModernWorkflowEditor layout */}

      {/* N8N-Style Node Panel (Tab key) */}
      <N8NStyleNodePanel
        isOpen={n8nNodePanelOpen}
        onClose={() => setN8nNodePanelOpen(false)}
        position={n8nNodePanelPosition}
        onSelectNode={(nodeType: string) => {
          const id = getId();
          const position = n8nNodePanelPosition || {
            x: 300 + Math.random() * 100,
            y: 200 + Math.random() * 100,
          };
          const newNode: WorkflowNode = {
            id,
            type: useN8nStyle ? 'n8n' : 'custom',
            position,
            data: createNodeData(id, nodeType, position) as WorkflowNode['data'],
          };
          const currentNodes = useWorkflowStore.getState().nodes;
          const currentEdges = useWorkflowStore.getState().edges;
          addToHistory(currentNodes, currentEdges);
          setNodes([...currentNodes, newNode]);
          setSelectedNode(newNode);
          setFocusPanelNode(newNode);
          setFocusPanelOpen(true);
          setN8nNodePanelOpen(false);
        }}
      />

      {/* N8N-Style Focus Panel (inline node editing) */}
      {focusPanelOpen && focusPanelNode && (
        <FocusPanel
          isOpen={focusPanelOpen}
          onClose={() => {
            setFocusPanelOpen(false);
            setFocusPanelNode(null);
          }}
          node={{
            id: focusPanelNode.id,
            type: focusPanelNode.data?.type || 'unknown',
            label: focusPanelNode.data?.label || 'Node',
            icon: focusPanelNode.data?.icon,
            color: focusPanelNode.data?.color,
            parameters: focusPanelNode.data?.config || {},
          }}
          onSave={(updatedNode) => {
            const currentNodes = useWorkflowStore.getState().nodes;
            const currentEdges = useWorkflowStore.getState().edges;
            addToHistory(currentNodes, currentEdges);

            const updatedNodes = currentNodes.map((n) =>
              n.id === focusPanelNode.id
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      label: updatedNode.label,
                      config: updatedNode.parameters,
                    },
                  }
                : n
            );
            setNodes(updatedNodes);
            notificationService.success('Node saved', 'Changes applied');
          }}
          onExecute={() => {
            window.dispatchEvent(new CustomEvent('execute-node', { detail: { nodeId: focusPanelNode.id } }));
            setFocusPanelOpen(false);
          }}
          onDelete={() => {
            const currentNodes = useWorkflowStore.getState().nodes;
            const currentEdges = useWorkflowStore.getState().edges;
            addToHistory(currentNodes, currentEdges);
            setNodes(currentNodes.filter((n) => n.id !== focusPanelNode.id));
            setEdges(
              currentEdges.filter(
                (e) => e.source !== focusPanelNode.id && e.target !== focusPanelNode.id
              )
            );
            setFocusPanelOpen(false);
            setFocusPanelNode(null);
            setSelectedNode(null);
            notificationService.success('Node deleted', 'Node removed from workflow');
          }}
          executionStatus={
            (nodeExecutionStatus[focusPanelNode.id] as
              | 'idle'
              | 'executing'
              | 'success'
              | 'error') || 'idle'
          }
        />
      )}

      {/* Data Preview Tooltip */}
      {dataPreview && (
        <Suspense fallback={<LoadingFallback darkMode={darkMode} />}>
          <DataPreviewTooltip
            nodeId={dataPreview.nodeId}
            position={{ x: dataPreview.x, y: dataPreview.y }}
            onClose={() => setDataPreview(null)}
          />
        </Suspense>
      )}

      {/* Pin Data Panel */}
      {pinDataPanel && (
        <Suspense fallback={<ModalLoadingFallback darkMode={darkMode} />}>
          <PinDataPanel
            nodeId={pinDataPanel.nodeId}
            nodeName={pinDataPanel.nodeName}
            isOpen={true}
            onClose={() => setPinDataPanel(null)}
          />
        </Suspense>
      )}

      {/* Execution Progress Overlay */}
      {isExecuting && (
        <Suspense fallback={<LoadingFallback darkMode={darkMode} />}>
          <ExecutionProgressOverlay isVisible={isExecuting} />
        </Suspense>
      )}

      {/* Bulk Operations Panel */}
      {bulkPanelOpen && selectedNodes.length > 1 && (
        <Suspense fallback={<LoadingFallback darkMode={darkMode} />}>
          <BulkOperationsPanel
            selectedNodeIds={selectedNodes}
            isOpen={bulkPanelOpen}
            onClose={() => setBulkPanelOpen(false)}
            onDelete={handleBulkDelete}
            onDuplicate={handleBulkDuplicate}
            onAlign={handleBulkAlign}
            onDistribute={handleBulkDistribute}
            onToggleEnabled={handleBulkToggleEnabled}
          />
        </Suspense>
      )}

      {/* Data Pinning Panel */}
      <DataPinningPanel
        isOpen={dataPinningPanelOpen}
        onClose={() => setDataPinningPanelOpen(false)}
        selectedNodeId={selectedNode?.id}
      />

      {/* Execution History Panel */}
      <ExecutionHistoryPanel
        isOpen={executionHistoryOpen}
        onClose={() => setExecutionHistoryOpen(false)}
        onReplayExecution={async (executionId: string) => {
          try {
            const response = await fetch(`/api/executions/${executionId}/replay`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            });
            const data = await response.json();
            if (data.success) {
              notificationService.success(`Replay started: ${data.replayExecutionId || data.executionId}`);
            } else {
              notificationService.error(data.error || 'Failed to replay execution');
            }
          } catch (_err) {
            notificationService.error('Failed to replay execution');
          }
        }}
      />

      {/* Enhanced Node Search */}
      <EnhancedNodeSearch
        isOpen={nodeSearchOpen}
        onClose={() => setNodeSearchOpen(false)}
        onNodeSelect={(nodeId) => {
          const node = nodes.find((n) => n.id === nodeId);
          if (node) {
            setSelectedNode(node);
            setConfigPanelOpen(true);
          }
        }}
      />

      {/* Workflow Variables Panel */}
      <WorkflowVariablesPanel
        isOpen={variablesPanelOpen}
        onClose={() => setVariablesPanelOpen(false)}
      />

      {/* Custom Node Creator */}
      <CustomNodeCreator
        isOpen={customNodeCreatorOpen}
        onClose={() => setCustomNodeCreatorOpen(false)}
      />

      {/* Workflow Documentation Generator */}
      <WorkflowDocGenerator
        isOpen={docGeneratorOpen}
        onClose={() => setDocGeneratorOpen(false)}
      />

      {/* Collaboration Indicators */}
      <CollaborationIndicators
        isOpen={collaborationOpen}
        onClose={() => setCollaborationOpen(false)}
      />

      {/* Step Debug Panel */}
      {stepDebugPanelOpen && (
        <Suspense fallback={<ModalLoadingFallback darkMode={darkMode} />}>
          <StepDebugPanel
            isOpen={stepDebugPanelOpen}
            onClose={() => setStepDebugPanelOpen(false)}
            onNodeHighlight={setHighlightedDebugNode}
          />
        </Suspense>
      )}

      {/* Enhanced Status Bar */}
      <Suspense fallback={<LoadingFallback darkMode={darkMode} />}>
        <EnhancedStatusBar
          zoomLevel={zoomLevel}
          viewMode={viewMode}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onZoomTo={zoomTo}
          onFitView={fitView}
          onToggleGrid={() => setShowGrid(!showGrid)}
          onToggleMiniMap={() => setShowMiniMap(!showMiniMap)}
          onOpenShortcuts={() => setShortcutsModalOpen(true)}
          showGrid={showGrid}
          showMiniMap={showMiniMap}
          darkMode={darkMode}
        />
      </Suspense>
    </>
  );
};

export default EditorPanels;
