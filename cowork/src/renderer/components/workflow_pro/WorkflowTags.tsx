/**
 * Workflow Tags Component
 * Manage tags for workflow organization and filtering
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Tag,
  Plus,
  X,
  Search,
  Check,
  ChevronDown,
  Edit2,
  Trash2,
  Palette,
} from 'lucide-react';
import { useWorkflowStore } from '../../store/workflowStore';

export interface WorkflowTag {
  id: string;
  name: string;
  color: string;
  count?: number;
}

interface WorkflowTagsProps {
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  availableTags?: WorkflowTag[];
  onCreateTag?: (tag: Omit<WorkflowTag, 'id'>) => void;
  onDeleteTag?: (tagId: string) => void;
  onEditTag?: (tagId: string, updates: Partial<WorkflowTag>) => void;
  editable?: boolean;
  showCounts?: boolean;
}

const TAG_COLORS = [
  { name: 'Gray', value: '#6b7280' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Purple', value: '#8b5cf6' },
  { name: 'Pink', value: '#ec4899' },
];

// Default tags
const DEFAULT_TAGS: WorkflowTag[] = [
  { id: 'tag_production', name: 'Production', color: '#22c55e', count: 5 },
  { id: 'tag_development', name: 'Development', color: '#3b82f6', count: 12 },
  { id: 'tag_testing', name: 'Testing', color: '#f97316', count: 3 },
  { id: 'tag_deprecated', name: 'Deprecated', color: '#ef4444', count: 2 },
  { id: 'tag_integration', name: 'Integration', color: '#8b5cf6', count: 8 },
  { id: 'tag_automation', name: 'Automation', color: '#14b8a6', count: 15 },
];

const WorkflowTags: React.FC<WorkflowTagsProps> = ({
  selectedTags,
  onTagsChange,
  availableTags = DEFAULT_TAGS,
  onCreateTag,
  onDeleteTag,
  onEditTag,
  editable = true,
  showCounts = false,
}) => {
  const darkMode = useWorkflowStore((state) => state.darkMode);

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[6].value);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsCreating(false);
        setShowColorPicker(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus input when opening
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Filter tags by search
  const filteredTags = availableTags.filter((tag) =>
    tag.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Toggle tag selection
  const toggleTag = useCallback(
    (tagId: string) => {
      if (selectedTags.includes(tagId)) {
        onTagsChange(selectedTags.filter((id) => id !== tagId));
      } else {
        onTagsChange([...selectedTags, tagId]);
      }
    },
    [selectedTags, onTagsChange]
  );

  // Remove tag
  const removeTag = useCallback(
    (tagId: string) => {
      onTagsChange(selectedTags.filter((id) => id !== tagId));
    },
    [selectedTags, onTagsChange]
  );

  // Create new tag
  const createTag = useCallback(() => {
    if (!newTagName.trim()) return;

    const newTag: Omit<WorkflowTag, 'id'> = {
      name: newTagName.trim(),
      color: newTagColor,
    };

    onCreateTag?.(newTag);
    setNewTagName('');
    setNewTagColor(TAG_COLORS[6].value);
    setIsCreating(false);
  }, [newTagName, newTagColor, onCreateTag]);

  // Get tag by ID
  const getTagById = useCallback(
    (tagId: string) => availableTags.find((t) => t.id === tagId),
    [availableTags]
  );

  return (
    <div ref={containerRef} className="relative">
      {/* Selected tags display */}
      <div
        className={`flex flex-wrap gap-1.5 p-2 rounded-lg border cursor-pointer min-h-[42px] ${
          darkMode
            ? 'bg-gray-800 border-gray-700 hover:border-gray-600'
            : 'bg-white border-gray-200 hover:border-gray-300'
        }`}
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedTags.length === 0 ? (
          <span className="text-gray-400 text-sm flex items-center gap-1">
            <Tag className="w-4 h-4" />
            Click to add tags...
          </span>
        ) : (
          <>
            {selectedTags.map((tagId) => {
              const tag = getTagById(tagId);
              if (!tag) return null;

              return (
                <span
                  key={tagId}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-white"
                  style={{ backgroundColor: tag.color }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {tag.name}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTag(tagId);
                    }}
                    className="hover:bg-white/20 rounded-full p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
          </>
        )}
        <ChevronDown
          className={`w-4 h-4 text-gray-400 ml-auto transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div
          className={`absolute z-50 mt-1 w-full rounded-lg shadow-xl border overflow-hidden ${
            darkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
          }`}
        >
          {/* Search */}
          <div className={`p-2 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tags..."
                className={`w-full pl-9 pr-3 py-1.5 rounded text-sm ${
                  darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
                } border outline-none`}
              />
            </div>
          </div>

          {/* Tags list */}
          <div className="max-h-48 overflow-y-auto">
            {filteredTags.length === 0 && !isCreating ? (
              <div className="p-4 text-center text-sm text-gray-500">
                No tags found
              </div>
            ) : (
              <div className="p-1">
                {filteredTags.map((tag) => {
                  const isSelected = selectedTags.includes(tag.id);
                  const isEditing = editingTagId === tag.id;

                  return (
                    <div
                      key={tag.id}
                      className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer ${
                        darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                      }`}
                    >
                      <div
                        className="flex items-center gap-2 flex-1"
                        onClick={() => toggleTag(tag.id)}
                      >
                        <div
                          className="w-4 h-4 rounded flex items-center justify-center"
                          style={{ backgroundColor: tag.color }}
                        >
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        {isEditing ? (
                          <input
                            type="text"
                            defaultValue={tag.name}
                            onBlur={(e) => {
                              onEditTag?.(tag.id, { name: e.target.value });
                              setEditingTagId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                onEditTag?.(tag.id, { name: e.currentTarget.value });
                                setEditingTagId(null);
                              }
                              if (e.key === 'Escape') {
                                setEditingTagId(null);
                              }
                            }}
                            autoFocus
                            className={`px-1 py-0.5 text-sm rounded ${
                              darkMode ? 'bg-gray-700' : 'bg-gray-200'
                            }`}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span className="text-sm">{tag.name}</span>
                        )}
                        {showCounts && tag.count !== undefined && (
                          <span className="text-xs text-gray-500">({tag.count})</span>
                        )}
                      </div>

                      {editable && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                          {/* Color picker */}
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowColorPicker(showColorPicker === tag.id ? null : tag.id);
                              }}
                              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                            >
                              <Palette className="w-3 h-3 text-gray-400" />
                            </button>
                            {showColorPicker === tag.id && (
                              <div
                                className={`absolute right-0 top-full mt-1 p-2 rounded shadow-lg z-50 flex gap-1 ${
                                  darkMode ? 'bg-gray-800' : 'bg-white'
                                }`}
                              >
                                {TAG_COLORS.map((color) => (
                                  <button
                                    key={color.value}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onEditTag?.(tag.id, { color: color.value });
                                      setShowColorPicker(null);
                                    }}
                                    className={`w-5 h-5 rounded-full border-2 ${
                                      tag.color === color.value
                                        ? 'ring-2 ring-offset-1'
                                        : ''
                                    }`}
                                    style={{
                                      backgroundColor: color.value,
                                      borderColor: color.value,
                                    }}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTagId(tag.id);
                            }}
                            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                          >
                            <Edit2 className="w-3 h-3 text-gray-400" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteTag?.(tag.id);
                            }}
                            className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30"
                          >
                            <Trash2 className="w-3 h-3 text-red-500" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Create new tag */}
          {editable && (
            <div className={`p-2 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              {isCreating ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Tag name"
                    autoFocus
                    className={`w-full px-2 py-1 text-sm rounded ${
                      darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
                    } border`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createTag();
                      if (e.key === 'Escape') setIsCreating(false);
                    }}
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1">
                      {TAG_COLORS.map((color) => (
                        <button
                          key={color.value}
                          onClick={() => setNewTagColor(color.value)}
                          className={`w-5 h-5 rounded-full ${
                            newTagColor === color.value ? 'ring-2 ring-offset-1' : ''
                          }`}
                          style={{ backgroundColor: color.value }}
                        />
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setIsCreating(false)}
                        className={`px-2 py-1 text-xs rounded ${
                          darkMode ? 'bg-gray-800' : 'bg-gray-200'
                        }`}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={createTag}
                        disabled={!newTagName.trim()}
                        className="px-2 py-1 text-xs rounded bg-blue-500 text-white disabled:opacity-50"
                      >
                        Create
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setIsCreating(true)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded ${
                    darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
                  }`}
                >
                  <Plus className="w-4 h-4 text-blue-500" />
                  Create new tag
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkflowTags;
