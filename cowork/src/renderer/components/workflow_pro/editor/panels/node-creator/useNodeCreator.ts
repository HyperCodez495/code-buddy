/**
 * Custom Node Creator Hook
 * Main state and logic for managing custom node creation and editing
 */

import { useState, useCallback } from 'react';
import {
  CustomNodeDefinition,
  NodeInput,
  NodeOutput,
  TestResult,
  TabType,
  DEFAULT_CODE,
} from './types';

export interface UseNodeCreatorReturn {
  // State
  customNodes: CustomNodeDefinition[];
  activeTab: TabType;
  editingNode: CustomNodeDefinition | null;
  isCreating: boolean;
  formData: Partial<CustomNodeDefinition>;
  error: string | null;
  testResult: TestResult | null;

  // Actions
  setActiveTab: (tab: TabType) => void;
  setFormData: React.Dispatch<React.SetStateAction<Partial<CustomNodeDefinition>>>;
  startCreating: () => void;
  startEditing: (node: CustomNodeDefinition) => void;
  cancelEditing: () => void;
  saveNode: () => void;
  deleteNode: (id: string) => void;
  duplicateNode: (node: CustomNodeDefinition) => void;
  exportNodes: () => void;

  // Input/Output management
  addInput: () => void;
  removeInput: (id: string) => void;
  updateInput: (id: string, updates: Partial<NodeInput>) => void;
  addOutput: () => void;
  removeOutput: (id: string) => void;
  updateOutput: (id: string, updates: Partial<NodeOutput>) => void;

  // Code testing
  testCode: () => Promise<void>;
}

const INITIAL_CUSTOM_NODES: CustomNodeDefinition[] = [
  {
    id: 'custom_1',
    name: 'dataTransformer',
    displayName: 'Data Transformer',
    category: 'Transform',
    description: 'Transform data between formats',
    icon: 'Zap',
    color: '#8b5cf6',
    inputs: [
      { id: 'in_1', name: 'data', type: 'json', required: true },
      { id: 'in_2', name: 'format', type: 'string', required: false, default: 'json' },
    ],
    outputs: [
      { id: 'out_1', name: 'result', type: 'json' },
    ],
    code: DEFAULT_CODE,
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 3600000,
  },
];

export function useNodeCreator(
  onSave?: (node: CustomNodeDefinition) => void
): UseNodeCreatorReturn {
  const [customNodes, setCustomNodes] = useState<CustomNodeDefinition[]>(INITIAL_CUSTOM_NODES);
  const [activeTab, setActiveTab] = useState<TabType>('basic');
  const [editingNode, setEditingNode] = useState<CustomNodeDefinition | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState<Partial<CustomNodeDefinition>>({
    name: '',
    displayName: '',
    category: 'Custom',
    description: '',
    icon: 'Box',
    color: '#3b82f6',
    inputs: [],
    outputs: [],
    code: DEFAULT_CODE,
  });
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const startCreating = useCallback(() => {
    setIsCreating(true);
    setEditingNode(null);
    setFormData({
      name: '',
      displayName: '',
      category: 'Custom',
      description: '',
      icon: 'Box',
      color: '#3b82f6',
      inputs: [],
      outputs: [{ id: 'out_1', name: 'result', type: 'any' }],
      code: DEFAULT_CODE,
    });
    setActiveTab('basic');
    setError(null);
    setTestResult(null);
  }, []);

  const startEditing = useCallback((node: CustomNodeDefinition) => {
    setEditingNode(node);
    setIsCreating(true);
    setFormData({ ...node });
    setActiveTab('basic');
    setError(null);
    setTestResult(null);
  }, []);

  const cancelEditing = useCallback(() => {
    setIsCreating(false);
    setEditingNode(null);
    setFormData({});
    setError(null);
    setTestResult(null);
  }, []);

  const validateForm = useCallback(() => {
    if (!formData.name?.trim()) return 'Node name is required';
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(formData.name)) {
      return 'Name must start with a letter and contain only alphanumeric characters';
    }
    if (!formData.displayName?.trim()) return 'Display name is required';
    if (!formData.code?.trim()) return 'Node code is required';

    if (!editingNode && customNodes.some((n) => n.name === formData.name)) {
      return 'A node with this name already exists';
    }

    return null;
  }, [formData, editingNode, customNodes]);

  const saveNode = useCallback(() => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    const node: CustomNodeDefinition = {
      id: editingNode?.id || `custom_${Date.now()}`,
      name: formData.name!,
      displayName: formData.displayName!,
      category: formData.category || 'Custom',
      description: formData.description || '',
      icon: formData.icon || 'Box',
      color: formData.color || '#3b82f6',
      inputs: formData.inputs || [],
      outputs: formData.outputs || [{ id: 'out_1', name: 'result', type: 'any' }],
      code: formData.code || DEFAULT_CODE,
      createdAt: editingNode?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    if (editingNode) {
      setCustomNodes((prev) => prev.map((n) => (n.id === editingNode.id ? node : n)));
    } else {
      setCustomNodes((prev) => [...prev, node]);
    }

    onSave?.(node);
    cancelEditing();
  }, [formData, editingNode, validateForm, onSave, cancelEditing]);

  const deleteNode = useCallback((id: string) => {
    setCustomNodes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const duplicateNode = useCallback((node: CustomNodeDefinition) => {
    const newNode: CustomNodeDefinition = {
      ...node,
      id: `custom_${Date.now()}`,
      name: `${node.name}Copy`,
      displayName: `${node.displayName} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setCustomNodes((prev) => [...prev, newNode]);
  }, []);

  const addInput = useCallback(() => {
    setFormData((prev) => {
      const newInput: NodeInput = {
        id: `in_${Date.now()}`,
        name: `input${(prev.inputs?.length || 0) + 1}`,
        type: 'any',
        required: false,
      };
      return {
        ...prev,
        inputs: [...(prev.inputs || []), newInput],
      };
    });
  }, []);

  const removeInput = useCallback((id: string) => {
    setFormData((prev) => ({
      ...prev,
      inputs: prev.inputs?.filter((i) => i.id !== id) || [],
    }));
  }, []);

  const updateInput = useCallback((id: string, updates: Partial<NodeInput>) => {
    setFormData((prev) => ({
      ...prev,
      inputs: prev.inputs?.map((i) => (i.id === id ? { ...i, ...updates } : i)) || [],
    }));
  }, []);

  const addOutput = useCallback(() => {
    setFormData((prev) => {
      const newOutput: NodeOutput = {
        id: `out_${Date.now()}`,
        name: `output${(prev.outputs?.length || 0) + 1}`,
        type: 'any',
      };
      return {
        ...prev,
        outputs: [...(prev.outputs || []), newOutput],
      };
    });
  }, []);

  const removeOutput = useCallback((id: string) => {
    setFormData((prev) => ({
      ...prev,
      outputs: prev.outputs?.filter((o) => o.id !== id) || [],
    }));
  }, []);

  const updateOutput = useCallback((id: string, updates: Partial<NodeOutput>) => {
    setFormData((prev) => ({
      ...prev,
      outputs: prev.outputs?.map((o) => (o.id === id ? { ...o, ...updates } : o)) || [],
    }));
  }, []);

  const testCode = useCallback(async () => {
    try {
      const mockInputs: Record<string, unknown> = {};
      for (const input of formData.inputs || []) {
        try {
          switch (input.type) {
            case 'string':
              mockInputs[input.name] = input.default || 'test';
              break;
            case 'number':
              mockInputs[input.name] = Number(input.default) || 42;
              break;
            case 'boolean':
              mockInputs[input.name] = input.default === 'true';
              break;
            case 'json':
              if (input.default) {
                try {
                  mockInputs[input.name] = JSON.parse(input.default);
                } catch {
                  mockInputs[input.name] = { test: true };
                  console.warn(`Invalid JSON for input ${input.name}, using default`);
                }
              } else {
                mockInputs[input.name] = { test: true };
              }
              break;
            default:
              mockInputs[input.name] = input.default || null;
          }
        } catch (inputError) {
          mockInputs[input.name] = null;
          console.warn(`Error processing input ${input.name}:`, inputError);
        }
      }

      const code = formData.code || '';

      const forbiddenPatterns = [
        /\beval\s*\(/,
        /\bFunction\s*\(/,
        /\bimport\s*\(/,
        /\brequire\s*\(/,
        /\bprocess\b/,
        /\b__proto__\b/,
        /\bconstructor\s*\[/,
      ];

      for (const pattern of forbiddenPatterns) {
        if (pattern.test(code)) {
          setTestResult({
            success: false,
            error: `Security Error: Forbidden pattern detected (${pattern.source})`,
          });
          return;
        }
      }

      const fn = new Function('inputs', `
        'use strict';
        const result = (function(inputs) {
          ${code}
        })(inputs);
        return result;
      `);

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Execution timeout (5s)')), 5000);
      });

      const executionPromise = Promise.resolve().then(() => fn(mockInputs));

      const result = await Promise.race([executionPromise, timeoutPromise]);

      setTestResult({ success: true, output: result });
    } catch (e) {
      setTestResult({
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  }, [formData.code, formData.inputs]);

  const exportNodes = useCallback(() => {
    const blob = new Blob([JSON.stringify(customNodes, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'custom-nodes.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [customNodes]);

  return {
    customNodes,
    activeTab,
    editingNode,
    isCreating,
    formData,
    error,
    testResult,
    setActiveTab,
    setFormData,
    startCreating,
    startEditing,
    cancelEditing,
    saveNode,
    deleteNode,
    duplicateNode,
    exportNodes,
    addInput,
    removeInput,
    updateInput,
    addOutput,
    removeOutput,
    updateOutput,
    testCode,
  };
}
