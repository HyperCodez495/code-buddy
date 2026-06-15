/**
 * Enhanced Node Search with Filtering
 * Advanced search for nodes in the workflow with filters by type, status, and more
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useWorkflowStore } from '../../../../store/workflowStore';
import { useReactFlow } from '@xyflow/react';
import {
  Search,
  Filter,
  X,
  ChevronDown,
  ChevronRight,
  EyeOff,
  AlertCircle,
  CheckCircle,
  Clock,
  Target,
  Layers,
} from 'lucide-react';

interface NodeSearchResult {
  id: string;
  label: string;
  type: string;
  category: string;
  hasError: boolean;
  isExecuting: boolean;
  isDisabled: boolean;
  tags: string[];
}

interface EnhancedNodeSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onNodeSelect?: (nodeId: string) => void;
}

const EnhancedNodeSearchComponent: React.FC<EnhancedNodeSearchProps> = ({
  isOpen,
  onClose,
  onNodeSelect,
}) => {
  const nodes = useWorkflowStore((state) => state.nodes);
  const darkMode = useWorkflowStore((state) => state.darkMode);
  const setSelectedNode = useWorkflowStore((state) => state.setSelectedNode);
  const nodeExecutionStatus = useWorkflowStore((state) => state.nodeExecutionStatus);

  const { _fitView, setCenter } = useReactFlow();

  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<'all' | 'error' | 'success' | 'running'>('all');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Get unique types and categories from nodes
  const { types, _categories } = useMemo(() => {
    const typeSet = new Set<string>();
    const categorySet = new Set<string>();

    nodes.forEach((node) => {
      if (node.type) typeSet.add(node.type);
      const nodeData = node.data as unknown as Record<string, unknown>;
      if (nodeData?.category) categorySet.add(nodeData.category as string);
    });

    return {
      types: Array.from(typeSet).sort(),
      categories: Array.from(categorySet).sort(),
    };
  }, [nodes]);

  // Process nodes for search
  const processedNodes = useMemo<NodeSearchResult[]>(() => {
    return nodes.map((node) => {
      const nodeData = node.data as unknown as Record<string, unknown>;
      const executionStatus = nodeExecutionStatus[node.id] || 'idle';

      return {
        id: node.id,
        label: (nodeData?.label as string) || node.id,
        type: node.type || 'default',
        category: (nodeData?.category as string) || 'uncategorized',
        hasError: executionStatus === 'error',
        isExecuting: executionStatus === 'running',
        isDisabled: nodeData?.disabled === true,
        tags: ((nodeData?.tags as string[]) || []),
      };
    });
  }, [nodes, nodeExecutionStatus]);

  // Filter and search nodes
  const filteredNodes = useMemo(() => {
    let results = processedNodes;

    // Apply search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      results = results.filter(
        (node) =>
          node.label.toLowerCase().includes(query) ||
          node.id.toLowerCase().includes(query) ||
          node.type.toLowerCase().includes(query) ||
          node.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    }

    // Apply type filter
    if (selectedTypes.size > 0) {
      results = results.filter((node) => selectedTypes.has(node.type));
    }

    // Apply category filter
    if (selectedCategories.size > 0) {
      results = results.filter((node) => selectedCategories.has(node.category));
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      results = results.filter((node) => {
        switch (statusFilter) {
          case 'error':
            return node.hasError;
          case 'success':
            return !node.hasError && !node.isExecuting;
          case 'running':
            return node.isExecuting;
          default:
            return true;
        }
      });
    }

    return results;
  }, [processedNodes, searchQuery, selectedTypes, selectedCategories, statusFilter]);

  // Group filtered nodes by category
  const groupedNodes = useMemo(() => {
    const groups: Record<string, NodeSearchResult[]> = {};

    filteredNodes.forEach((node) => {
      if (!groups[node.category]) {
        groups[node.category] = [];
      }
      groups[node.category].push(node);
    });

    return groups;
  }, [filteredNodes]);

  // Navigate to node
  const navigateToNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        setSelectedNode(node);
        setCenter(node.position.x + 100, node.position.y + 40, { duration: 300, zoom: 1.5 });
        onNodeSelect?.(nodeId);
      }
    },
    [nodes, setSelectedNode, setCenter, onNodeSelect]
  );

  // Toggle category expansion
  const toggleCategory = useCallback((category: string) => {
    setExpandedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  }, []);

  // Toggle type filter
  const toggleType = useCallback((type: string) => {
    setSelectedTypes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(type)) {
        newSet.delete(type);
      } else {
        newSet.add(type);
      }
      return newSet;
    });
  }, []);

  // Toggle category filter
  const _toggleCategoryFilter = useCallback((category: string) => {
    setSelectedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  }, []);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setSelectedTypes(new Set());
    setSelectedCategories(new Set());
    setStatusFilter('all');
    setSearchQuery('');
  }, []);

  // Reset selected index when filtered nodes change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredNodes.length]);

  // Keyboard navigation with bounds safety
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const maxIndex = Math.max(0, filteredNodes.length - 1);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, maxIndex));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const safeIndex = Math.min(selectedIndex, maxIndex);
        if (filteredNodes.length > 0 && filteredNodes[safeIndex]) {
          navigateToNode(filteredNodes[safeIndex].id);
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [filteredNodes, selectedIndex, navigateToNode, onClose]
  );

  // Get status icon
  const getStatusIcon = (node: NodeSearchResult) => {
    if (node.isExecuting) {
      return <Clock className="w-3.5 h-3.5 text-blue-500 animate-pulse" />;
    }
    if (node.hasError) {
      return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
    }
    if (node.isDisabled) {
      return <EyeOff className="w-3.5 h-3.5 text-gray-400" />;
    }
    return <CheckCircle className="w-3.5 h-3.5 text-green-500" />;
  };

  // Active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedTypes.size > 0) count++;
    if (selectedCategories.size > 0) count++;
    if (statusFilter !== 'all') count++;
    return count;
  }, [selectedTypes, selectedCategories, statusFilter]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed left-4 top-20 w-80 max-h-[calc(100vh-6rem)] overflow-hidden rounded-xl shadow-2xl border z-50 flex flex-col ${
        darkMode
          ? 'bg-gray-900 border-gray-700 text-white'
          : 'bg-white border-gray-200 text-gray-900'
      }`}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div
        className={`p-4 border-b ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold">Find Nodes</h3>
            <span
              className={`px-2 py-0.5 text-xs rounded-full ${
                darkMode ? 'bg-gray-800' : 'bg-gray-100'
              }`}
            >
              {filteredNodes.length}/{nodes.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, type, or tag..."
            className={`w-full pl-9 pr-10 py-2 rounded-lg text-sm ${
              darkMode
                ? 'bg-gray-800 border-gray-700 focus:border-blue-500'
                : 'bg-gray-50 border-gray-200 focus:border-blue-500'
            } border outline-none transition-colors`}
          />
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded transition-colors ${
              showFilters || activeFilterCount > 0
                ? 'text-blue-500'
                : darkMode
                ? 'text-gray-400 hover:text-white'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <Filter className="w-4 h-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-blue-500 text-white text-[9px] rounded-full flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div
          className={`p-3 border-b space-y-3 ${
            darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'
          }`}
        >
          {/* Status filter */}
          <div>
            <div className="text-xs text-gray-500 mb-2">Status</div>
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'success', 'error', 'running'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-2 py-1 text-xs rounded-full capitalize ${
                    statusFilter === status
                      ? 'bg-blue-500 text-white'
                      : darkMode
                      ? 'bg-gray-700 hover:bg-gray-600'
                      : 'bg-gray-200 hover:bg-gray-300'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {/* Type filter */}
          {types.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-2">Type</div>
              <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                {types.slice(0, 10).map((type) => (
                  <button
                    key={type}
                    onClick={() => toggleType(type)}
                    className={`px-2 py-1 text-xs rounded-full ${
                      selectedTypes.has(type)
                        ? 'bg-purple-500 text-white'
                        : darkMode
                        ? 'bg-gray-700 hover:bg-gray-600'
                        : 'bg-gray-200 hover:bg-gray-300'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Clear filters */}
          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="text-xs text-blue-500 hover:underline"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {filteredNodes.length === 0 ? (
          <div className="text-center py-12">
            <Search className="w-10 h-10 mx-auto mb-3 text-gray-400" />
            <p className="text-gray-500 text-sm">No nodes found</p>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="mt-2 text-xs text-blue-500 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {Object.entries(groupedNodes).map(([category, categoryNodes]) => (
              <div key={category}>
                <button
                  onClick={() => toggleCategory(category)}
                  className={`w-full px-3 py-2 flex items-center justify-between text-sm ${
                    darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {expandedCategories.has(category) ? (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    )}
                    <span className="font-medium capitalize">{category}</span>
                  </div>
                  <span
                    className={`px-1.5 py-0.5 text-xs rounded ${
                      darkMode ? 'bg-gray-800' : 'bg-gray-200'
                    }`}
                  >
                    {categoryNodes.length}
                  </span>
                </button>

                {expandedCategories.has(category) && (
                  <div className={darkMode ? 'bg-gray-800/30' : 'bg-gray-50/50'}>
                    {categoryNodes.map((node, index) => (
                      <button
                        key={node.id}
                        onClick={() => navigateToNode(node.id)}
                        className={`w-full px-4 py-2 flex items-center justify-between text-sm transition-colors ${
                          selectedIndex === index
                            ? darkMode
                              ? 'bg-blue-500/20'
                              : 'bg-blue-50'
                            : darkMode
                            ? 'hover:bg-gray-800'
                            : 'hover:bg-gray-100'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {getStatusIcon(node)}
                          <span className="truncate">{node.label}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span
                            className={`px-1.5 py-0.5 text-[10px] rounded ${
                              darkMode ? 'bg-gray-700' : 'bg-gray-200'
                            }`}
                          >
                            {node.type}
                          </span>
                          <Target className="w-3.5 h-3.5 text-gray-400" />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className={`p-2 border-t text-xs text-gray-500 flex items-center justify-between ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        <span>Use ↑↓ to navigate, Enter to select</span>
        <kbd className={`px-1.5 py-0.5 rounded ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
          Esc
        </kbd>
      </div>
    </div>
  );
};

const EnhancedNodeSearch = React.memo(EnhancedNodeSearchComponent, (prev, next) => {
  return prev.isOpen === next.isOpen;
});

export default EnhancedNodeSearch;
