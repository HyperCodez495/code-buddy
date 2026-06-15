/**
 * Node Form Component
 * Basic node information form (name, display name, category, description, color)
 */

import React from 'react';
import { CustomNodeDefinition, COLOR_OPTIONS, CATEGORY_OPTIONS } from './types';

interface NodeFormProps {
  formData: Partial<CustomNodeDefinition>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<CustomNodeDefinition>>>;
  darkMode: boolean;
}

export const NodeForm: React.FC<NodeFormProps> = ({
  formData,
  setFormData,
  darkMode,
}) => {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Node Name (ID)</label>
        <input
          type="text"
          value={formData.name || ''}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g., myCustomNode"
          className={`w-full px-3 py-2 rounded-lg text-sm font-mono ${
            darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
          } border`}
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Display Name</label>
        <input
          type="text"
          value={formData.displayName || ''}
          onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
          placeholder="e.g., My Custom Node"
          className={`w-full px-3 py-2 rounded-lg text-sm ${
            darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
          } border`}
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Category</label>
        <select
          value={formData.category || 'Custom'}
          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
          className={`w-full px-3 py-2 rounded-lg text-sm ${
            darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
          } border`}
        >
          {CATEGORY_OPTIONS.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea
          value={formData.description || ''}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Describe what this node does..."
          rows={2}
          className={`w-full px-3 py-2 rounded-lg text-sm resize-none ${
            darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
          } border`}
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-2">Color</label>
        <div className="flex gap-2 flex-wrap">
          {COLOR_OPTIONS.map((color) => (
            <button
              key={color}
              onClick={() => setFormData({ ...formData, color })}
              className={`w-8 h-8 rounded-lg transition-all ${
                formData.color === color ? 'ring-2 ring-offset-2 ring-orange-500' : ''
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default NodeForm;
