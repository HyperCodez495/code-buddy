/**
 * @deprecated This is the legacy EditorStatusBar from the panels/ directory.
 * The active version is in ../components/EditorStatusBar.tsx which is used
 * by ModernWorkflowEditor. This file is kept for backwards compatibility
 * but should not be used for new development. Remove in a future cleanup pass.
 *
 * EditorStatusBar Component
 * Bottom status bar for the workflow editor
 */

import React from 'react';
import { ViewMode } from '../config/editorConfig';

interface EditorStatusBarProps {
  nodeCount: number;
  edgeCount: number;
  currentEnvironment: string;
  zoomLevel: number;
  viewMode: ViewMode;
  workflowLastUpdate: string;
  darkMode: boolean;
}

const EditorStatusBarComponent: React.FC<EditorStatusBarProps> = ({
  nodeCount,
  edgeCount,
  currentEnvironment,
  zoomLevel,
  viewMode,
  workflowLastUpdate,
  darkMode,
}) => {
  return (
    <div className={`fixed bottom-0 left-0 right-0 h-8 ${
      darkMode ? 'bg-gray-800 text-gray-300 border-gray-700' : 'bg-white text-gray-700 border-gray-200'
    } border-t flex items-center px-4 text-xs z-30 transition-colors duration-300`}>
      <div className="flex items-center space-x-4">
        <span>Nodes: {nodeCount}</span>
        <span>Connections: {edgeCount}</span>
        <span>Environment: {currentEnvironment}</span>
        <span className="flex items-center">
          <span
            className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1 animate-pulse"
            aria-label="Connection status: connected"
          />
          Connected
        </span>
      </div>
      <div className="ml-auto flex items-center space-x-4">
        <span>Zoom: {Math.round(zoomLevel * 100)}%</span>
        <span>Mode: {typeof viewMode === 'string' ? viewMode : 'normal'}</span>
        <span>Last updated: {workflowLastUpdate}</span>
      </div>
    </div>
  );
};

export const EditorStatusBar = React.memo(EditorStatusBarComponent, (prev, next) => {
  return (
    prev.nodeCount === next.nodeCount &&
    prev.edgeCount === next.edgeCount &&
    prev.currentEnvironment === next.currentEnvironment &&
    prev.zoomLevel === next.zoomLevel &&
    prev.viewMode === next.viewMode &&
    prev.workflowLastUpdate === next.workflowLastUpdate &&
    prev.darkMode === next.darkMode
  );
});

export default EditorStatusBar;
