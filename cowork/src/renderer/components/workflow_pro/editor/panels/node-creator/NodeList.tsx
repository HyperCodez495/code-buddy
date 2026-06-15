/**
 * Node List Component
 * Displays the list of existing custom nodes with actions
 */

import React from 'react';
import { Puzzle, Copy, Edit2, Trash2 } from 'lucide-react';
import { CustomNodeDefinition } from './types';

interface NodeListProps {
  customNodes: CustomNodeDefinition[];
  darkMode: boolean;
  onEdit: (node: CustomNodeDefinition) => void;
  onDuplicate: (node: CustomNodeDefinition) => void;
  onDelete: (id: string) => void;
}

export const NodeList: React.FC<NodeListProps> = ({
  customNodes,
  darkMode,
  onEdit,
  onDuplicate,
  onDelete,
}) => {
  if (customNodes.length === 0) {
    return (
      <div className="text-center py-12">
        <Puzzle className="w-12 h-12 mx-auto mb-3 text-gray-400" />
        <p className="text-gray-500 text-sm">
          No custom nodes yet.
          <br />
          Create one to extend your workflow capabilities.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-700">
      {customNodes.map((node) => (
        <div
          key={node.id}
          className={`p-4 transition-colors ${
            darkMode ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50'
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center text-white"
                style={{ backgroundColor: node.color }}
              >
                <Puzzle className="w-5 h-5" />
              </div>
              <div>
                <div className="font-medium">{node.displayName}</div>
                <div className="text-xs text-gray-500 font-mono">{node.name}</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onDuplicate(node)}
                className={`p-1.5 rounded transition-colors ${
                  darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'
                }`}
                title="Duplicate"
              >
                <Copy className="w-4 h-4" />
              </button>
              <button
                onClick={() => onEdit(node)}
                className={`p-1.5 rounded transition-colors ${
                  darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'
                }`}
                title="Edit"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => onDelete(node.id)}
                className={`p-1.5 rounded transition-colors text-red-500 ${
                  darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-200'
                }`}
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          {node.description && (
            <p className="mt-2 text-sm text-gray-500">{node.description}</p>
          )}
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span
              className={`px-2 py-0.5 rounded ${
                darkMode ? 'bg-gray-800' : 'bg-gray-100'
              }`}
            >
              {node.category}
            </span>
            <span className="text-gray-500">
              {node.inputs.length} inputs, {node.outputs.length} outputs
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default NodeList;
