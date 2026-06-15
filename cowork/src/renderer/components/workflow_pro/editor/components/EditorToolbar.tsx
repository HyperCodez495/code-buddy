/**
 * EditorToolbar Component
 * Toolbar with action buttons for the workflow editor
 */

import React from 'react';
import {
  Save,
  Play,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid3X3,
  Map,
  Layout,
  Keyboard,
  Download,
  Upload,
  Bug,
  Sparkles,
  Pin,
  PinOff,
} from 'lucide-react';
import { SaveIndicator } from './SaveIndicator';

export interface EditorToolbarProps {
  /** Handler for save action */
  onSave?: () => void;
  /** Handler for execute/run workflow */
  onExecute?: () => void;
  /** Handler for undo */
  onUndo?: () => void;
  /** Handler for redo */
  onRedo?: () => void;
  /** Handler for zoom in */
  onZoomIn?: () => void;
  /** Handler for zoom out */
  onZoomOut?: () => void;
  /** Handler for fit view */
  onFitView?: () => void;
  /** Handler for toggle grid */
  onToggleGrid?: () => void;
  /** Handler for toggle minimap */
  onToggleMiniMap?: () => void;
  /** Handler for auto layout */
  onAutoLayout?: () => void;
  /** Handler for keyboard shortcuts modal */
  onShowShortcuts?: () => void;
  /** Handler for export */
  onExport?: () => void;
  /** Handler for import */
  onImport?: () => void;
  /** Handler for debug mode */
  onDebug?: () => void;
  /** Handler for AI builder */
  onOpenAIBuilder?: () => void;
  /** Handler for toggling pin data mode */
  onTogglePinData?: () => void;
  /** Whether pin data mode is active */
  usePinnedData?: boolean;
  /** Number of nodes with pinned data */
  pinnedNodeCount?: number;
  /** Whether workflow is currently executing */
  isExecuting?: boolean;
  /** Whether grid is shown */
  showGrid?: boolean;
  /** Whether minimap is shown */
  showMiniMap?: boolean;
  /** Whether undo is available */
  canUndo?: boolean;
  /** Whether redo is available */
  canRedo?: boolean;
  /** Whether dark mode is enabled */
  darkMode?: boolean;
  /** Current zoom level (0-100+) */
  zoomLevel?: number;
  /** Additional CSS classes */
  className?: string;
}

interface ToolbarButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  title: string;
  darkMode?: boolean;
  children: React.ReactNode;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  onClick,
  disabled = false,
  active = false,
  title,
  darkMode = false,
  children,
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={title}
    className={`
      p-2 rounded-lg transition-all duration-200
      ${disabled
        ? 'opacity-50 cursor-not-allowed'
        : 'hover:scale-105 active:scale-95'
      }
      ${active
        ? darkMode
          ? 'bg-blue-600 text-white'
          : 'bg-blue-500 text-white'
        : darkMode
          ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          : 'bg-white text-gray-700 hover:bg-gray-100'
      }
      border ${darkMode ? 'border-gray-600' : 'border-gray-200'}
      shadow-sm
    `}
  >
    {children}
  </button>
);

const ToolbarDivider: React.FC<{ darkMode?: boolean }> = ({ darkMode }) => (
  <div
    className={`w-px h-8 mx-1 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}
  />
);

/**
 * EditorToolbar - Action toolbar for the workflow editor
 *
 * Provides quick access to common workflow editing actions like
 * save, execute, undo/redo, zoom, and view toggles.
 */
export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  onSave,
  onExecute,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onFitView,
  onToggleGrid,
  onToggleMiniMap,
  onAutoLayout,
  onShowShortcuts,
  onExport,
  onImport,
  onDebug,
  onOpenAIBuilder,
  onTogglePinData,
  usePinnedData = false,
  pinnedNodeCount = 0,
  isExecuting = false,
  showGrid = true,
  showMiniMap = true,
  canUndo = true,
  canRedo = true,
  darkMode = false,
  zoomLevel = 100,
  className = '',
}) => {
  return (
    <div
      className={`
        flex items-center gap-1 p-2 rounded-xl
        ${darkMode ? 'bg-gray-800/90' : 'bg-white/90'}
        backdrop-blur-sm
        border ${darkMode ? 'border-gray-700' : 'border-gray-200'}
        shadow-lg
        ${className}
      `}
    >
      {/* Primary Actions */}
      <ToolbarButton
        onClick={onSave}
        title="Save workflow (Ctrl+S)"
        darkMode={darkMode}
      >
        <Save size={18} />
      </ToolbarButton>
      <SaveIndicator darkMode={darkMode} />

      <ToolbarButton
        onClick={onExecute}
        disabled={isExecuting}
        title="Execute workflow (Ctrl+E)"
        darkMode={darkMode}
      >
        <Play size={18} className={isExecuting ? 'animate-pulse' : ''} />
      </ToolbarButton>

      <ToolbarButton
        onClick={onTogglePinData}
        disabled={pinnedNodeCount === 0}
        active={usePinnedData && pinnedNodeCount > 0}
        title={
          pinnedNodeCount === 0
            ? 'No pinned data available'
            : usePinnedData
              ? `Pin Data Mode ON (${pinnedNodeCount} node${pinnedNodeCount !== 1 ? 's' : ''})`
              : `Use pinned data (${pinnedNodeCount} node${pinnedNodeCount !== 1 ? 's' : ''})`
        }
        darkMode={darkMode}
      >
        <div className="relative">
          {usePinnedData && pinnedNodeCount > 0 ? (
            <Pin size={18} className="text-amber-500" />
          ) : (
            <PinOff size={18} />
          )}
          {usePinnedData && pinnedNodeCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 flex items-center justify-center text-[8px] font-bold bg-amber-500 text-white rounded-full">
              {pinnedNodeCount}
            </span>
          )}
        </div>
      </ToolbarButton>

      <ToolbarDivider darkMode={darkMode} />

      {/* History */}
      <ToolbarButton
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        darkMode={darkMode}
      >
        <Undo2 size={18} />
      </ToolbarButton>

      <ToolbarButton
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
        darkMode={darkMode}
      >
        <Redo2 size={18} />
      </ToolbarButton>

      <ToolbarDivider darkMode={darkMode} />

      {/* Zoom Controls */}
      <ToolbarButton
        onClick={onZoomOut}
        title="Zoom out (Ctrl+-)"
        darkMode={darkMode}
      >
        <ZoomOut size={18} />
      </ToolbarButton>

      <span
        className={`
          px-2 min-w-[4rem] text-center text-sm font-medium
          ${darkMode ? 'text-gray-400' : 'text-gray-600'}
        `}
      >
        {Math.round(zoomLevel)}%
      </span>

      <ToolbarButton
        onClick={onZoomIn}
        title="Zoom in (Ctrl++)"
        darkMode={darkMode}
      >
        <ZoomIn size={18} />
      </ToolbarButton>

      <ToolbarButton
        onClick={onFitView}
        title="Fit view (Ctrl+F)"
        darkMode={darkMode}
      >
        <Maximize2 size={18} />
      </ToolbarButton>

      <ToolbarDivider darkMode={darkMode} />

      {/* View Toggles */}
      <ToolbarButton
        onClick={onToggleGrid}
        active={showGrid}
        title="Toggle grid (Ctrl+G)"
        darkMode={darkMode}
      >
        <Grid3X3 size={18} />
      </ToolbarButton>

      <ToolbarButton
        onClick={onToggleMiniMap}
        active={showMiniMap}
        title="Toggle minimap (Ctrl+M)"
        darkMode={darkMode}
      >
        <Map size={18} />
      </ToolbarButton>

      <ToolbarButton
        onClick={onAutoLayout}
        title="Auto layout (Ctrl+L)"
        darkMode={darkMode}
      >
        <Layout size={18} />
      </ToolbarButton>

      <ToolbarDivider darkMode={darkMode} />

      {/* Import/Export */}
      <ToolbarButton
        onClick={onImport}
        title="Import workflow"
        darkMode={darkMode}
      >
        <Upload size={18} />
      </ToolbarButton>

      <ToolbarButton
        onClick={onExport}
        title="Export workflow"
        darkMode={darkMode}
      >
        <Download size={18} />
      </ToolbarButton>

      <ToolbarDivider darkMode={darkMode} />

      {/* Advanced Features */}
      <ToolbarButton
        onClick={onDebug}
        title="Debug mode"
        darkMode={darkMode}
      >
        <Bug size={18} />
      </ToolbarButton>

      <ToolbarButton
        onClick={onOpenAIBuilder}
        title="AI Workflow Builder"
        darkMode={darkMode}
      >
        <Sparkles size={18} />
      </ToolbarButton>

      <ToolbarButton
        onClick={onShowShortcuts}
        title="Keyboard shortcuts (?)"
        darkMode={darkMode}
      >
        <Keyboard size={18} />
      </ToolbarButton>
    </div>
  );
};

export default EditorToolbar;
