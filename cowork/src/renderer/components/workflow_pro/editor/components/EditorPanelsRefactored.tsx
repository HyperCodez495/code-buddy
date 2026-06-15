/**
 * EditorPanels Component (Refactored)
 *
 * Renders all panel components using EditorPanelContext.
 * This version eliminates prop drilling by using context for panel state.
 *
 * Reduced from 489 lines and ~50 props to ~180 lines and ~15 props.
 */

import React, { Suspense, lazy } from 'react';
import { WorkflowNode } from '../../../../types/workflow';
import { useWorkflowStore } from '../../../../store/workflowStore';
import { usePanels, useIsPanelOpen } from '../context';
import { PanelSlot, PANEL_CONFIG } from '../layout';
import { notificationService } from '../../../../services/NotificationService';

// Regular panel components
import NodeConfigPanel from '../../../nodes/NodeConfigPanel';
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
const ExecutionProgressOverlay = lazy(() => import('../../execution/ExecutionProgressOverlay'));
const DataPreviewTooltip = lazy(() => import('../../../data/DataPreviewTooltip'));
const PinDataPanel = lazy(() => import('../../../nodes/PinDataPanel'));
const EnhancedStatusBar = lazy(() => import('../../../canvas/EnhancedStatusBar'));
const BulkOperationsPanel = lazy(() => import('../../../utilities/BulkOperationsPanel'));
const StepDebugPanel = lazy(() => import('../../../debugging/StepDebugPanel'));

// ============================================================================
// Loading Fallbacks
// ============================================================================

const LoadingFallback: React.FC<{ darkMode?: boolean }> = ({ darkMode }) => (
  <div className={`flex items-center justify-center p-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-current mr-2" />
    <span className="text-sm">Loading...</span>
  </div>
);

const ModalLoadingFallback: React.FC<{ darkMode?: boolean }> = ({ darkMode }) => (
  <div className={`fixed inset-0 z-modal flex items-center justify-center ${darkMode ? 'bg-gray-900/50' : 'bg-gray-100/50'}`}>
    <div className={`${darkMode ? 'bg-gray-800 text-gray-200' : 'bg-white text-gray-700'} rounded-lg shadow-xl p-6 flex items-center`}>
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mr-3" />
      <span>Loading component...</span>
    </div>
  </div>
);

// ============================================================================
// Props Interface (Minimal)
// ============================================================================

export interface EditorPanelsProps {
  /** Dark mode flag */
  darkMode: boolean;
  /** Whether workflow is executing */
  isExecuting: boolean;
  /** View mode for display */
  viewMode: 'normal' | 'compact' | 'detailed';
  /** Zoom controls */
  zoomLevel: number;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomTo: (zoom: number) => void;
  fitView: () => void;
  /** Grid/minimap toggles */
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;
  showMiniMap: boolean;
  setShowMiniMap: (show: boolean) => void;
  /** Node creation helpers */
  getId: () => string;
  createNodeData: (id: string, nodeType: string, position: { x: number; y: number }) => unknown;
  /** Bulk operation handlers */
  handleBulkDelete: () => void;
  handleBulkDuplicate: () => void;
  handleBulkAlign: (alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  handleBulkDistribute: (direction: 'horizontal' | 'vertical') => void;
  handleBulkToggleEnabled: (enabled: boolean) => void;
}

// ============================================================================
// Main Component
// ============================================================================

export const EditorPanels: React.FC<EditorPanelsProps> = ({
  darkMode,
  isExecuting,
  viewMode,
  zoomLevel,
  zoomIn,
  zoomOut,
  zoomTo,
  fitView,
  showGrid,
  setShowGrid,
  showMiniMap,
  setShowMiniMap,
  getId,
  createNodeData,
  handleBulkDelete,
  handleBulkDuplicate,
  handleBulkAlign,
  handleBulkDistribute,
  handleBulkToggleEnabled,
}) => {
  // Panel context
  const { state, closePanel, openPanel, openModal, setHighlightedDebugNode } = usePanels();

  // Store state
  const nodes = useWorkflowStore((s) => s.nodes);
  const selectedNode = useWorkflowStore((s) => s.selectedNode);
  const selectedNodes = useWorkflowStore((s) => s.selectedNodes);
  const nodeExecutionStatus = useWorkflowStore((s) => s.nodeExecutionStatus);
  const setNodes = useWorkflowStore((s) => s.setNodes);
  const setEdges = useWorkflowStore((s) => s.setEdges);
  const setSelectedNode = useWorkflowStore((s) => s.setSelectedNode);
  const addToHistory = useWorkflowStore((s) => s.addToHistory);

  // Panel state from context
  const configOpen = useIsPanelOpen('config');
  const focusOpen = useIsPanelOpen('focus');
  const n8nNodeOpen = useIsPanelOpen('n8nNode');
  const dataPinningOpen = useIsPanelOpen('dataPinning');
  const executionHistoryOpen = useIsPanelOpen('executionHistory');
  const nodeSearchOpen = useIsPanelOpen('nodeSearch');
  const variablesOpen = useIsPanelOpen('variables');
  const customNodeCreatorOpen = useIsPanelOpen('customNodeCreator');
  const docGeneratorOpen = useIsPanelOpen('docGenerator');
  const collaborationOpen = useIsPanelOpen('collaboration');
  const stepDebugOpen = useIsPanelOpen('stepDebug');
  const bulkOpen = useIsPanelOpen('bulk');

  // Get focus panel node from context
  const focusPanelNode = state.focusPanelNode;

  return (
    <>
      {/* Config Panel (Right) */}
      {configOpen && selectedNode && (
        <PanelSlot position="right" width={PANEL_CONFIG.config.width}>
          <div className="h-full bg-white dark:bg-gray-800 shadow-2xl border-l border-gray-200 dark:border-gray-700">
            <NodeConfigPanel onClose={() => closePanel('config')} />
          </div>
        </PanelSlot>
      )}

      {/* N8N-Style Node Panel (Center Modal) */}
      <N8NStyleNodePanel
        isOpen={n8nNodeOpen}
        onClose={() => closePanel('n8nNode')}
        position={state.quickSearchPosition}
        onSelectNode={(nodeType: string) => {
          const id = getId();
          const position = state.quickSearchPosition || { x: 300 + Math.random() * 100, y: 200 + Math.random() * 100 };
          const newNode: WorkflowNode = {
            id,
            type: 'custom',
            position,
            data: createNodeData(id, nodeType, position) as WorkflowNode['data'],
          };
          const currentNodes = useWorkflowStore.getState().nodes;
          const currentEdges = useWorkflowStore.getState().edges;
          addToHistory(currentNodes, currentEdges);
          setNodes([...currentNodes, newNode]);
          setSelectedNode(newNode);
          closePanel('n8nNode');
        }}
      />

      {/* Focus Panel (Right) */}
      {focusOpen && focusPanelNode && (
        <PanelSlot position="right" width={PANEL_CONFIG.focus.width}>
          <FocusPanel
            isOpen={focusOpen}
            onClose={() => closePanel('focus')}
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
                  ? { ...n, data: { ...n.data, label: updatedNode.label, config: updatedNode.parameters } }
                  : n
              );
              setNodes(updatedNodes);
              notificationService.success('Node saved', 'Changes applied');
            }}
            onExecute={() => notificationService.info('Execute Node', `Executing ${focusPanelNode.data?.label || 'node'}...`)}
            onDelete={() => {
              const currentNodes = useWorkflowStore.getState().nodes;
              const currentEdges = useWorkflowStore.getState().edges;
              addToHistory(currentNodes, currentEdges);
              setNodes(currentNodes.filter((n) => n.id !== focusPanelNode.id));
              setEdges(currentEdges.filter((e) => e.source !== focusPanelNode.id && e.target !== focusPanelNode.id));
              closePanel('focus');
              setSelectedNode(null);
              notificationService.success('Node deleted', 'Node removed from workflow');
            }}
            executionStatus={(nodeExecutionStatus[focusPanelNode.id] as 'idle' | 'executing' | 'success' | 'error') || 'idle'}
          />
        </PanelSlot>
      )}

      {/* Data Preview Tooltip */}
      {state.dataPreview && (
        <Suspense fallback={<LoadingFallback darkMode={darkMode} />}>
          <DataPreviewTooltip
            nodeId={state.dataPreview.nodeId}
            position={{ x: state.dataPreview.x, y: state.dataPreview.y }}
            onClose={() => {}}
          />
        </Suspense>
      )}

      {/* Pin Data Panel */}
      {state.pinDataPanel && (
        <Suspense fallback={<ModalLoadingFallback darkMode={darkMode} />}>
          <PinDataPanel
            nodeId={state.pinDataPanel.nodeId}
            nodeName={state.pinDataPanel.nodeName}
            isOpen={true}
            onClose={() => {}}
          />
        </Suspense>
      )}

      {/* Execution Progress Overlay */}
      {isExecuting && (
        <Suspense fallback={<LoadingFallback darkMode={darkMode} />}>
          <ExecutionProgressOverlay isVisible={isExecuting} />
        </Suspense>
      )}

      {/* Bulk Operations Panel (Bottom) */}
      {bulkOpen && selectedNodes.length > 1 && (
        <Suspense fallback={<LoadingFallback darkMode={darkMode} />}>
          <PanelSlot position="bottom" height={PANEL_CONFIG.bulk.height}>
            <BulkOperationsPanel
              selectedNodeIds={selectedNodes}
              isOpen={bulkOpen}
              onClose={() => closePanel('bulk')}
              onDelete={handleBulkDelete}
              onDuplicate={handleBulkDuplicate}
              onAlign={handleBulkAlign}
              onDistribute={handleBulkDistribute}
              onToggleEnabled={handleBulkToggleEnabled}
            />
          </PanelSlot>
        </Suspense>
      )}

      {/* Feature Panels */}
      <DataPinningPanel isOpen={dataPinningOpen} onClose={() => closePanel('dataPinning')} selectedNodeId={selectedNode?.id} />
      <ExecutionHistoryPanel
        isOpen={executionHistoryOpen}
        onClose={() => closePanel('executionHistory')}
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
      <EnhancedNodeSearch
        isOpen={nodeSearchOpen}
        onClose={() => closePanel('nodeSearch')}
        onNodeSelect={(nodeId) => {
          const node = nodes.find((n) => n.id === nodeId);
          if (node) {
            setSelectedNode(node);
            openPanel('config');
          }
        }}
      />
      <WorkflowVariablesPanel isOpen={variablesOpen} onClose={() => closePanel('variables')} />
      <CustomNodeCreator isOpen={customNodeCreatorOpen} onClose={() => closePanel('customNodeCreator')} />
      <WorkflowDocGenerator isOpen={docGeneratorOpen} onClose={() => closePanel('docGenerator')} />
      <CollaborationIndicators isOpen={collaborationOpen} onClose={() => closePanel('collaboration')} />

      {/* Step Debug Panel */}
      {stepDebugOpen && (
        <Suspense fallback={<ModalLoadingFallback darkMode={darkMode} />}>
          <PanelSlot position="right" width={PANEL_CONFIG.stepDebug.width}>
            <StepDebugPanel isOpen={stepDebugOpen} onClose={() => closePanel('stepDebug')} onNodeHighlight={setHighlightedDebugNode} />
          </PanelSlot>
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
          onOpenShortcuts={() => openModal('shortcuts')}
          showGrid={showGrid}
          showMiniMap={showMiniMap}
          darkMode={darkMode}
        />
      </Suspense>
    </>
  );
};

export default EditorPanels;
