/**
 * Workflow Organizer Panel
 * Folder tree + filtered workflow list with tag filtering and search
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Folder,
  FolderPlus,
  Tag,
  Search,
  ChevronRight,
  ChevronDown,
  File,
  X,
} from 'lucide-react';
import { useWorkflowStore } from '../../store/workflowStore';

interface WorkflowOrganizerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectWorkflow: (id: string) => void;
}

const WorkflowOrganizer: React.FC<WorkflowOrganizerProps> = ({
  isOpen,
  onClose,
  onSelectWorkflow,
}) => {
  const workflows = useWorkflowStore((s) => s.workflows);
  const folders = useWorkflowStore((s) => s.workflowFolders);
  const folderMap = useWorkflowStore((s) => s.workflowFolderMap);
  const createFolder = useWorkflowStore((s) => s.createFolder);
  const deleteFolder = useWorkflowStore((s) => s.deleteFolder);

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTagFilters, setActiveTagFilters] = useState<Set<string>>(new Set());
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    Object.values(workflows).forEach((wf) => wf.tags?.forEach((t) => tags.add(t)));
    return Array.from(tags);
  }, [workflows]);

  const filteredWorkflows = useMemo(() => {
    return Object.values(workflows).filter((wf) => {
      if (selectedFolderId && folderMap[wf.id] !== selectedFolderId) return false;
      if (!selectedFolderId && folderMap[wf.id]) return false;
      if (searchQuery && !wf.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (activeTagFilters.size > 0) {
        const wfTags = new Set(wf.tags || []);
        for (const tag of activeTagFilters) {
          if (!wfTags.has(tag)) return false;
        }
      }
      return true;
    });
  }, [workflows, selectedFolderId, folderMap, searchQuery, activeTagFilters]);

  const toggleFolder = useCallback((id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleTag = useCallback((tag: string) => {
    setActiveTagFilters((prev) => {
      const next = new Set(prev);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return next;
    });
  }, []);

  const handleCreateFolder = useCallback(() => {
    if (newFolderName.trim()) {
      createFolder(newFolderName.trim());
      setNewFolderName('');
      setShowNewFolder(false);
    }
  }, [newFolderName, createFolder]);

  if (!isOpen) return null;

  const rootFolders = folders.filter((f) => !f.parentId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[720px] max-h-[80vh] flex flex-col border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Workflow Organizer
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Search + Tag filters */}
        <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2 text-gray-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search workflows..."
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border transition-colors ${
                    activeTagFilters.has(tag)
                      ? 'bg-blue-100 dark:bg-blue-900 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                      : 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  <Tag size={10} />
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Folder sidebar */}
          <div className="w-48 border-r border-gray-200 dark:border-gray-700 overflow-y-auto p-2 space-y-0.5">
            <button
              onClick={() => setSelectedFolderId(null)}
              className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-xs rounded transition-colors ${
                !selectedFolderId
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <Folder size={14} />
              All Workflows
            </button>

            {rootFolders.map((folder) => {
              const children = folders.filter((f) => f.parentId === folder.id);
              const isExpanded = expandedFolders.has(folder.id);
              return (
                <div key={folder.id}>
                  <div className="flex items-center group">
                    {children.length > 0 && (
                      <button onClick={() => toggleFolder(folder.id)} className="p-0.5">
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedFolderId(folder.id)}
                      className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 text-xs rounded transition-colors ${
                        selectedFolderId === folder.id
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      <Folder size={14} style={folder.color ? { color: folder.color } : undefined} />
                      <span className="truncate">{folder.name}</span>
                    </button>
                    <button
                      onClick={() => deleteFolder(folder.id)}
                      className="hidden group-hover:block p-0.5 text-gray-400 hover:text-red-500"
                      title="Delete folder"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  {isExpanded &&
                    children.map((child) => (
                      <button
                        key={child.id}
                        onClick={() => setSelectedFolderId(child.id)}
                        className={`w-full flex items-center gap-1.5 pl-7 pr-2 py-1.5 text-xs rounded transition-colors ${
                          selectedFolderId === child.id
                            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                      >
                        <Folder size={12} style={child.color ? { color: child.color } : undefined} />
                        <span className="truncate">{child.name}</span>
                      </button>
                    ))}
                </div>
              );
            })}

            {/* Create folder */}
            {showNewFolder ? (
              <div className="flex items-center gap-1 px-1">
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                  placeholder="Folder name"
                  className="flex-1 px-1.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none"
                />
                <button onClick={handleCreateFolder} className="text-blue-500 text-xs font-medium">
                  Add
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNewFolder(true)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              >
                <FolderPlus size={14} />
                Create folder
              </button>
            )}
          </div>

          {/* Workflow list */}
          <div className="flex-1 overflow-y-auto p-2">
            {filteredWorkflows.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-8">
                No workflows found
              </p>
            ) : (
              <div className="space-y-1">
                {filteredWorkflows.map((wf) => (
                  <button
                    key={wf.id}
                    onClick={() => onSelectWorkflow(wf.id)}
                    className="w-full flex items-start gap-2 px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                  >
                    <File size={14} className="text-gray-400 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                        {wf.name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {wf.tags?.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center px-1.5 py-0 text-[10px] rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                          >
                            {tag}
                          </span>
                        ))}
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">
                          {new Date(wf.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(WorkflowOrganizer);
