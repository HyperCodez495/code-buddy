/**
 * usePathValidation Hook
 * Validation logic for path builder
 */

import { useCallback, useMemo } from 'react';
import type {
  PathBuilderConfig,
  PathNode,
  ValidationState,
  ValidationError,
  ValidationWarning,
} from './types';

export interface UsePathValidationOptions {
  config: PathBuilderConfig;
}

export interface UsePathValidationReturn {
  validationState: ValidationState;
  validateConfig: () => ValidationState;
  validateNode: (node: PathNode) => ValidationError[];
  getNodeErrors: (nodeId: string) => ValidationError[];
  getNodeWarnings: (nodeId: string) => ValidationWarning[];
  hasErrors: boolean;
  hasWarnings: boolean;
}

export function usePathValidation({ config }: UsePathValidationOptions): UsePathValidationReturn {
  const getOutgoingConnections = useCallback((nodeId: string) => {
    return config.connections.filter(conn => conn.source === nodeId);
  }, [config.connections]);

  const getIncomingConnections = useCallback((nodeId: string) => {
    return config.connections.filter(conn => conn.target === nodeId);
  }, [config.connections]);

  const validateNode = useCallback((node: PathNode): ValidationError[] => {
    const errors: ValidationError[] = [];

    switch (node.type) {
      case 'condition':
        if (!node.data.conditions || node.data.conditions.length === 0) {
          errors.push({
            field: `node.${node.id}.conditions`,
            message: `Condition node "${node.name}" has no conditions defined`,
            code: 'MISSING_CONDITIONS'
          });
        }
        break;

      case 'action':
        if (!node.data.actions || node.data.actions.length === 0) {
          errors.push({
            field: `node.${node.id}.actions`,
            message: `Action node "${node.name}" has no actions defined`,
            code: 'MISSING_ACTIONS'
          });
        }
        break;

      case 'loop':
        if (!node.data.loopConfig) {
          errors.push({
            field: `node.${node.id}.loopConfig`,
            message: `Loop node "${node.name}" has no configuration`,
            code: 'MISSING_LOOP_CONFIG'
          });
        }
        break;

      case 'switch':
        if (!node.data.switchConfig || !node.data.switchConfig.cases ||
          node.data.switchConfig.cases.length === 0) {
          errors.push({
            field: `node.${node.id}.switchConfig`,
            message: `Switch node "${node.name}" has no cases defined`,
            code: 'MISSING_SWITCH_CASES'
          });
        }
        break;
    }

    return errors;
  }, []);

  const validateConfig = useCallback((): ValidationState => {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check for orphaned nodes
    config.nodes.forEach(node => {
      const incoming = getIncomingConnections(node.id);
      const outgoing = getOutgoingConnections(node.id);

      if (incoming.length === 0 && outgoing.length === 0) {
        warnings.push({
          field: `node.${node.id}`,
          message: `Node "${node.name}" is not connected`,
          code: 'ORPHANED_NODE'
        });
      }
    });

    // Check for circular dependencies
    const visited = new Set<string>();
    const stack = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      if (stack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      stack.add(nodeId);

      const connections = getOutgoingConnections(nodeId);
      for (const conn of connections) {
        if (hasCycle(conn.target)) return true;
      }

      stack.delete(nodeId);
      return false;
    };

    config.nodes.forEach(node => {
      if (hasCycle(node.id)) {
        errors.push({
          field: `node.${node.id}`,
          message: `Circular dependency detected at node "${node.name}"`,
          code: 'CIRCULAR_DEPENDENCY'
        });
      }
    });

    // Validate node configurations
    config.nodes.forEach(node => {
      const nodeErrors = validateNode(node);
      errors.push(...nodeErrors);
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }, [config.nodes, getIncomingConnections, getOutgoingConnections, validateNode]);

  const validationState = useMemo(() => validateConfig(), [validateConfig]);

  const getNodeErrors = useCallback((nodeId: string): ValidationError[] => {
    return validationState.errors.filter(error =>
      error.field.startsWith(`node.${nodeId}`)
    );
  }, [validationState.errors]);

  const getNodeWarnings = useCallback((nodeId: string): ValidationWarning[] => {
    return validationState.warnings.filter(warning =>
      warning.field.startsWith(`node.${nodeId}`)
    );
  }, [validationState.warnings]);

  return {
    validationState,
    validateConfig,
    validateNode,
    getNodeErrors,
    getNodeWarnings,
    hasErrors: validationState.errors.length > 0,
    hasWarnings: validationState.warnings.length > 0,
  };
}
