/**
 * Types for Custom Node Creator
 */

export interface NodeInput {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'any';
  required: boolean;
  default?: string;
  description?: string;
}

export interface NodeOutput {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'any';
}

export interface CustomNodeDefinition {
  id: string;
  name: string;
  displayName: string;
  category: string;
  description: string;
  icon: string;
  color: string;
  inputs: NodeInput[];
  outputs: NodeOutput[];
  code: string;
  createdAt: number;
  updatedAt: number;
}

export interface CustomNodeCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (node: CustomNodeDefinition) => void;
}

export interface TestResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

export type TabType = 'basic' | 'inputs' | 'outputs' | 'code';

// Constants
export const ICON_OPTIONS = ['Box', 'Zap', 'Code', 'Settings', 'Puzzle', 'Star', 'Database', 'Globe', 'Mail', 'Cloud'];

export const COLOR_OPTIONS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#6366f1',
];

export const CATEGORY_OPTIONS = ['Custom', 'Data', 'Integration', 'Utility', 'Transform', 'AI'];

export const DEFAULT_CODE = `// Access inputs via 'inputs' object
// Return output via 'return' statement

async function execute(inputs) {
  // Your custom logic here
  const result = {
    processed: true,
    data: inputs.data,
    timestamp: new Date().toISOString()
  };

  return result;
}

return execute(inputs);
`;
