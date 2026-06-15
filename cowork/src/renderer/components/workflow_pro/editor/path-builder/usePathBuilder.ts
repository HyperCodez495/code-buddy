/**
 * usePathBuilder Hook
 * State management and actions for the path builder
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import * as crypto from 'crypto';
import { PathEngine } from './PathEngine';
import type {
  PathBuilderConfig,
  PathNode,
  PathNodeType,
  PathConnection,
  ConnectionType,
  Position,
  ValidationState,
  SimulationResult,
  TestScenario,
} from './types';

export interface UsePathBuilderOptions {
  config: PathBuilderConfig;
  onChange?: (config: PathBuilderConfig) => void;
  onExecute?: (input: unknown) => Promise<unknown>;
  onTest?: (scenario: TestScenario) => Promise<SimulationResult>;
  readOnly?: boolean;
}

export interface UsePathBuilderReturn {
  // State
  selectedNode: string | null;
  selectedConnection: string | null;
  draggedNode: string | null;
  isTestMode: boolean;
  testResults: SimulationResult | null;
  validationState: ValidationState | null;
  engine: PathEngine;

  // Node actions
  selectNode: (nodeId: string | null) => void;
  addNode: (type: PathNodeType, position: Position) => void;
  deleteNode: (nodeId: string) => void;
  updateNodePosition: (nodeId: string, position: Position) => void;
  startDragNode: (nodeId: string) => void;
  endDragNode: (nodeId: string, position: Position) => void;

  // Connection actions
  selectConnection: (connectionId: string | null) => void;
  createConnection: (source: string, target: string, type?: ConnectionType) => void;
  deleteConnection: (connectionId: string) => void;

  // Test actions
  toggleTestMode: () => void;
  runTest: () => Promise<void>;

  // Validation actions
  validate: () => void;
}

function generateId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function usePathBuilder({
  config,
  onChange,
  onTest,
  readOnly = false,
}: UsePathBuilderOptions): UsePathBuilderReturn {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
  const [draggedNode, setDraggedNode] = useState<string | null>(null);
  const [isTestMode, setIsTestMode] = useState(false);
  const [testResults, setTestResults] = useState<SimulationResult | null>(null);
  const [validationState, setValidationState] = useState<ValidationState | null>(null);

  const engineRef = useRef<PathEngine>(new PathEngine(config));

  // Update engine when config changes
  useEffect(() => {
    engineRef.current = new PathEngine(config);
    if (config.settings.validateOnChange) {
      const validation = engineRef.current.validate();
      setValidationState(validation);
    }
  }, [config]);

  // Node actions
  const selectNode = useCallback((nodeId: string | null) => {
    if (!readOnly) {
      setSelectedNode(nodeId);
      setSelectedConnection(null);
    }
  }, [readOnly]);

  const addNode = useCallback((type: PathNodeType, position: Position) => {
    if (!readOnly && onChange) {
      const newNode: PathNode = {
        id: generateId(),
        type,
        name: `New ${type} node`,
        position,
        data: {},
        connections: [],
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date()
        },
        validation: {
          isValid: true,
          errors: [],
          warnings: []
        }
      };

      const updatedConfig = {
        ...config,
        nodes: [...config.nodes, newNode]
      };
      onChange(updatedConfig);
    }
  }, [readOnly, onChange, config]);

  const deleteNode = useCallback((nodeId: string) => {
    if (!readOnly && onChange) {
      const updatedConfig = {
        ...config,
        nodes: config.nodes.filter(node => node.id !== nodeId),
        connections: config.connections.filter(
          conn => conn.source !== nodeId && conn.target !== nodeId
        )
      };
      onChange(updatedConfig);
      setSelectedNode(null);
    }
  }, [readOnly, onChange, config]);

  const updateNodePosition = useCallback((nodeId: string, position: Position) => {
    if (!readOnly && onChange) {
      const updatedConfig = {
        ...config,
        nodes: config.nodes.map(node =>
          node.id === nodeId
            ? { ...node, position }
            : node
        )
      };
      onChange(updatedConfig);
    }
  }, [readOnly, onChange, config]);

  const startDragNode = useCallback((nodeId: string) => {
    if (!readOnly) {
      setDraggedNode(nodeId);
    }
  }, [readOnly]);

  const endDragNode = useCallback((nodeId: string, position: Position) => {
    if (!readOnly && onChange) {
      updateNodePosition(nodeId, position);
      setDraggedNode(null);
    }
  }, [readOnly, onChange, updateNodePosition]);

  // Connection actions
  const selectConnection = useCallback((connectionId: string | null) => {
    if (!readOnly) {
      setSelectedConnection(connectionId);
      setSelectedNode(null);
    }
  }, [readOnly]);

  const createConnection = useCallback((
    source: string,
    target: string,
    type: ConnectionType = 'success'
  ) => {
    if (!readOnly && onChange) {
      const newConnection: PathConnection = {
        id: generateId(),
        source,
        target,
        type,
        animated: config.settings.animateConnections
      };

      const updatedConfig = {
        ...config,
        connections: [...config.connections, newConnection]
      };
      onChange(updatedConfig);
    }
  }, [readOnly, onChange, config]);

  const deleteConnection = useCallback((connectionId: string) => {
    if (!readOnly && onChange) {
      const updatedConfig = {
        ...config,
        connections: config.connections.filter(conn => conn.id !== connectionId)
      };
      onChange(updatedConfig);
      setSelectedConnection(null);
    }
  }, [readOnly, onChange, config]);

  // Test actions
  const toggleTestMode = useCallback(() => {
    setIsTestMode(prev => !prev);
  }, []);

  const runTest = useCallback(async () => {
    if (onTest && isTestMode) {
      const testScenario: TestScenario = {
        id: generateId(),
        name: 'Manual Test',
        input: { test: true }
      };

      const result = await onTest(testScenario);
      setTestResults(result);
    }
  }, [onTest, isTestMode]);

  // Validation actions
  const validate = useCallback(() => {
    const validation = engineRef.current.validate();
    setValidationState(validation);
  }, []);

  return {
    // State
    selectedNode,
    selectedConnection,
    draggedNode,
    isTestMode,
    testResults,
    validationState,
    engine: engineRef.current,

    // Node actions
    selectNode,
    addNode,
    deleteNode,
    updateNodePosition,
    startDragNode,
    endDragNode,

    // Connection actions
    selectConnection,
    createConnection,
    deleteConnection,

    // Test actions
    toggleTestMode,
    runTest,

    // Validation actions
    validate,
  };
}
