/**
 * Port Editor Component
 * Editor for input and output ports of custom nodes
 */

import React from 'react';
import { Plus, Trash2, Type, Hash, ToggleLeft, FileJson, Box } from 'lucide-react';
import { NodeInput, NodeOutput, CustomNodeDefinition } from './types';

interface PortEditorProps {
  type: 'inputs' | 'outputs';
  formData: Partial<CustomNodeDefinition>;
  darkMode: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<NodeInput | NodeOutput>) => void;
}

const getTypeIcon = (type: string) => {
  switch (type) {
    case 'string':
      return <Type className="w-3.5 h-3.5" />;
    case 'number':
      return <Hash className="w-3.5 h-3.5" />;
    case 'boolean':
      return <ToggleLeft className="w-3.5 h-3.5" />;
    case 'json':
      return <FileJson className="w-3.5 h-3.5" />;
    default:
      return <Box className="w-3.5 h-3.5" />;
  }
};

export const PortEditor: React.FC<PortEditorProps> = ({
  type,
  formData,
  darkMode,
  onAdd,
  onRemove,
  onUpdate,
}) => {
  const items = type === 'inputs' ? formData.inputs : formData.outputs;
  const isInputs = type === 'inputs';
  const label = isInputs ? 'Node Inputs' : 'Node Outputs';
  const addLabel = isInputs ? 'Add Input' : 'Add Output';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <button
          onClick={onAdd}
          className="px-2 py-1 text-xs rounded bg-orange-500 text-white flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          {addLabel}
        </button>
      </div>

      {(!items || items.length === 0) && isInputs && (
        <p className="text-sm text-gray-500 text-center py-4">
          No inputs defined. Click "{addLabel}" to create one.
        </p>
      )}

      {items?.map((item) => (
        <div
          key={item.id}
          className={`p-3 rounded-lg border ${
            darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {getTypeIcon(item.type)}
              <input
                type="text"
                value={item.name}
                onChange={(e) => onUpdate(item.id, { name: e.target.value })}
                className={`px-2 py-1 rounded text-sm font-mono ${
                  darkMode ? 'bg-gray-900' : 'bg-white'
                }`}
              />
            </div>
            <button
              onClick={() => onRemove(item.id)}
              className="p-1 text-red-500 hover:bg-red-500/10 rounded"
              disabled={!isInputs && items?.length === 1}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex gap-2">
            <select
              value={item.type}
              onChange={(e) =>
                onUpdate(item.id, { type: e.target.value as NodeInput['type'] })
              }
              className={`px-2 py-1 rounded text-xs ${
                darkMode ? 'bg-gray-900' : 'bg-white'
              }`}
            >
              <option value="any">Any</option>
              <option value="string">String</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
              <option value="json">JSON</option>
            </select>
            {isInputs && 'required' in item && (
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={(item as NodeInput).required}
                  onChange={(e) => onUpdate(item.id, { required: e.target.checked })}
                />
                Required
              </label>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default PortEditor;
