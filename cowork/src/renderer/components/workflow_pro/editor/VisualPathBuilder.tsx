/**
 * Visual Path Builder Component
 * Advanced visual interface for creating conditional paths and branching logic
 * Similar to Zapier Paths but more powerful
 */

import React from 'react';
import {
  // Types (re-export for backward compatibility)
  type PathNode,
  type PathNodeType,
  type PathNodeData,
  type PathConnection,
  type ConnectionType,
  type Condition,
  type OperatorType,
  type DataType,
  type Action,
  type ActionType,
  type ActionConfig,
  type MergeStrategy,
  type SplitStrategy,
  type AggregationType,
  type LoopConfig,
  type SwitchConfig,
  type SwitchCase,
  type Variable,
  type ErrorHandling,
  type RetryConfig,
  type PathNodeMetadata,
  type NodeMetrics,
  type ValidationState,
  type ValidationError,
  type ValidationWarning,
  type ExecutionState,
  type PathBuilderConfig,
  type PathBuilderSettings,
  type PathBuilderMetadata,
  type PathPermissions,
  type TestScenario,
  type Assertion,
  type PathCoverage,
  type SimulationResult,
  type AssertionResult,
  type PathTemplate,
  type PathPattern,
  type ConnectionStyle,
  type Position,
  // Engine
  PathEngine,
  // Hooks
  usePathBuilder,
  // Components
  PathCanvas,
  PathToolbar,
  PathProperties,
  PathValidation,
  PathTestResults,
} from './path-builder';

// Re-export types for backward compatibility
export type {
  PathNode,
  PathNodeType,
  PathNodeData,
  PathConnection,
  ConnectionType,
  Condition,
  OperatorType,
  DataType,
  Action,
  ActionType,
  ActionConfig,
  MergeStrategy,
  SplitStrategy,
  AggregationType,
  LoopConfig,
  SwitchConfig,
  SwitchCase,
  Variable,
  ErrorHandling,
  RetryConfig,
  PathNodeMetadata,
  NodeMetrics,
  ValidationState,
  ValidationError,
  ValidationWarning,
  ExecutionState,
  PathBuilderConfig,
  PathBuilderSettings,
  PathBuilderMetadata,
  PathPermissions,
  TestScenario,
  Assertion,
  PathCoverage,
  SimulationResult,
  AssertionResult,
  PathTemplate,
  PathPattern,
  ConnectionStyle,
  Position,
};

// Re-export the engine for backward compatibility
export { PathEngine };

// ============================================================================
// VISUAL PATH BUILDER COMPONENT
// ============================================================================

interface VisualPathBuilderProps {
  config: PathBuilderConfig;
  onChange?: (config: PathBuilderConfig) => void;
  onExecute?: (input: unknown) => Promise<unknown>;
  onTest?: (scenario: TestScenario) => Promise<SimulationResult>;
  readOnly?: boolean;
  className?: string;
}

export const VisualPathBuilder: React.FC<VisualPathBuilderProps> = ({
  config,
  onChange,
  onExecute,
  onTest,
  readOnly = false,
  className = ''
}) => {
  const {
    selectedNode,
    selectedConnection,
    isTestMode,
    testResults,
    validationState,
    selectNode,
    addNode,
    deleteNode,
    startDragNode,
    endDragNode,
    selectConnection,
    deleteConnection,
    toggleTestMode,
    runTest,
    validate,
  } = usePathBuilder({
    config,
    onChange,
    onExecute,
    onTest,
    readOnly,
  });

  // Clear validation state on dismiss
  const handleDismissValidation = React.useCallback(() => {
    // In a real implementation, this would clear the validation state
    // For now, we just leave it since usePathBuilder manages the state
  }, []);

  // Clear test results on close
  const handleCloseTestResults = React.useCallback(() => {
    // In a real implementation, this would clear the test results
    // For now, we just leave it since usePathBuilder manages the state
  }, []);

  return (
    <div
      className={`visual-path-builder ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#ffffff',
        borderRadius: '8px',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
        overflow: 'hidden',
      }}
    >
      {/* Toolbar */}
      <PathToolbar
        onAddNode={addNode}
        onValidate={validate}
        onToggleTestMode={toggleTestMode}
        onRunTest={runTest}
        isTestMode={isTestMode}
        readOnly={readOnly}
      />

      {/* Main content area */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
        }}
      >
        {/* Canvas */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'auto',
          }}
        >
          <PathCanvas
            config={config}
            selectedNode={selectedNode}
            selectedConnection={selectedConnection}
            onNodeClick={selectNode}
            onNodeDragStart={startDragNode}
            onNodeDragEnd={endDragNode}
            onConnectionClick={selectConnection}
            readOnly={readOnly}
          />
        </div>

        {/* Properties panel (sidebar) */}
        <div
          style={{
            width: '280px',
            borderLeft: '1px solid #e5e7eb',
            backgroundColor: '#f9fafb',
            overflowY: 'auto',
          }}
        >
          <PathProperties
            config={config}
            selectedNode={selectedNode}
            selectedConnection={selectedConnection}
            onDeleteNode={deleteNode}
            onDeleteConnection={deleteConnection}
            readOnly={readOnly}
          />
        </div>
      </div>

      {/* Bottom panels */}
      <div>
        {/* Validation panel */}
        {validationState && (validationState.errors.length > 0 || validationState.warnings.length > 0) && (
          <PathValidation
            validationState={validationState}
            onDismiss={handleDismissValidation}
          />
        )}

        {/* Test results panel */}
        {testResults && (
          <PathTestResults
            results={testResults}
            onClose={handleCloseTestResults}
          />
        )}
      </div>
    </div>
  );
};

export default VisualPathBuilder;
