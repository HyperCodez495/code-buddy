/**
 * FileTree — Recursive file tree browser for the workspace
 */
import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Search } from 'lucide-react';
import { useAppStore } from '../store';

interface FileEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
  path: string;
}

interface FileTreeProps {
  rootPath: string;
}

interface TreeNodeProps {
  entry: FileEntry;
  depth: number;
  onFileClick: (path: string) => void;
  onFileDoubleClick: (path: string) => void;
  loadChildren: (path: string) => Promise<FileEntry[]>;
}

const TreeNode: React.FC<TreeNodeProps> = React.memo(({ entry, depth, onFileClick, onFileDoubleClick, loadChildren }) => {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (!entry.isDirectory) return;
    if (!expanded && children.length === 0) {
      setLoading(true);
      try {
        const items = await loadChildren(entry.path);
        setChildren(items.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        }));
      } catch { /* ignore */ }
      setLoading(false);
    }
    setExpanded(!expanded);
  }, [expanded, children.length, entry, loadChildren]);

  const handleClick = useCallback(() => {
    if (entry.isDirectory) {
      toggle();
    } else {
      onFileClick(entry.path);
    }
  }, [entry, toggle, onFileClick]);

  const handleDoubleClick = useCallback(() => {
    if (!entry.isDirectory) {
      onFileDoubleClick(entry.path);
    }
  }, [entry, onFileDoubleClick]);

  return (
    <div>
      <button
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        className="w-full flex items-center gap-1 px-2 py-0.5 text-left hover:bg-surface transition-colors group"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        title={entry.path}
      >
        {entry.isDirectory ? (
          <>
            {expanded ? (
              <ChevronDown size={12} className="text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight size={12} className="text-muted-foreground flex-shrink-0" />
            )}
            {expanded ? (
              <FolderOpen size={14} className="text-yellow-500 flex-shrink-0" />
            ) : (
              <Folder size={14} className="text-yellow-600 flex-shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-3" />
            <File size={14} className="text-muted-foreground flex-shrink-0" />
          </>
        )}
        <span className="text-xs text-secondary truncate ml-1">{entry.name}</span>
        {loading && <span className="text-xs text-muted-foreground ml-auto">...</span>}
      </button>

      {expanded && children.map((child) => (
        <TreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          onFileClick={onFileClick}
          onFileDoubleClick={onFileDoubleClick}
          loadChildren={loadChildren}
        />
      ))}
    </div>
  );
});

TreeNode.displayName = 'TreeNode';

export const FileTree: React.FC<FileTreeProps> = ({ rootPath }) => {
  const { t } = useTranslation();
  const [rootEntries, setRootEntries] = useState<FileEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const setPreviewFilePath = useAppStore((s) => s.setPreviewFilePath);

  const loadChildren = useCallback(async (dirPath: string): Promise<FileEntry[]> => {
    try {
      const api = (window as { electronAPI?: { workspace?: { readDir?: (p: string) => Promise<FileEntry[]> } } }).electronAPI;
      if (api?.workspace?.readDir) {
        return await api.workspace.readDir(dirPath);
      }
    } catch { /* ignore */ }
    return [];
  }, []);

  useEffect(() => {
    if (!rootPath) return;
    setLoading(true);
    loadChildren(rootPath).then((entries) => {
      setRootEntries(entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      }));
      setLoading(false);
    });
  }, [rootPath, loadChildren]);

  const handleFileClick = useCallback(
    (filePath: string) => {
      // Phase 2 step 9: open the file preview pane on single-click.
      setPreviewFilePath(filePath);
    },
    [setPreviewFilePath]
  );

  const handleFileDoubleClick = useCallback((filePath: string) => {
    // Reveal in OS file explorer on double-click.
    const api = (window as { electronAPI?: { showItemInFolder?: (p: string) => void } })
      .electronAPI;
    api?.showItemInFolder?.(filePath);
  }, []);

  const filtered = filter
    ? rootEntries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
    : rootEntries;

  return (
    <div>
      {/* Search */}
      <div className="relative px-3 py-2">
        <Search size={12} className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('fileTree.filterPlaceholder', 'Filter files…')}
          className="w-full pl-6 pr-2 py-1 text-xs bg-surface border border-border rounded text-secondary placeholder:text-muted-foreground focus:outline-none focus:border-zinc-500"
        />
      </div>

      {/* Tree */}
      <div className="max-h-64 overflow-y-auto">
        {loading ? (
          <div className="text-xs text-muted-foreground px-3 py-2">{t('common.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="text-xs text-muted-foreground px-3 py-2">
            {t('fileTree.empty', 'No files found')}
          </div>
        ) : (
          filtered.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              onFileClick={handleFileClick}
              onFileDoubleClick={handleFileDoubleClick}
              loadChildren={loadChildren}
            />
          ))
        )}
      </div>
    </div>
  );
};
