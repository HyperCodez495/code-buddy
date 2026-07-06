import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, Search, Clock, Tag, RefreshCw, FileText, Pencil, Trash2, Plus } from 'lucide-react';
import { useActiveProjectId } from '../store/selectors';
import { formatAppDate } from '../utils/i18n-format';

interface MemoryEntry {
  category: 'preference' | 'pattern' | 'context' | 'decision' | string;
  content: string;
  sourceSessionId?: string;
  timestamp: number;
  originalIndex: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  preference: 'bg-accent-muted text-accent border-accent/30',
  pattern: 'bg-accent-muted text-accent border-accent/30',
  context: 'bg-surface-active text-text-secondary border-border',
  decision: 'bg-warning/20 text-warning border-warning/30',
};

const CATEGORIES = ['preference', 'pattern', 'context', 'decision'] as const;
type MemoryCategory = (typeof CATEGORIES)[number];

export const MemoryInspector: React.FC = () => {
  const { t } = useTranslation();
  const activeProjectId = useActiveProjectId();
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState<MemoryCategory>('preference');

  const [isAdding, setIsAdding] = useState(false);
  const [addContent, setAddContent] = useState('');
  const [addCategory, setAddCategory] = useState<MemoryCategory>(CATEGORIES[0]);

  const loadEntries = async () => {
    setLoading(true);
    try {
      const api = window.electronAPI;
      if (!api?.memory) {
        setEntries([]);
        return;
      }
      const result = (await api.memory.list(activeProjectId ?? undefined)) as MemoryEntry[];
      setEntries(result.map((e, i) => ({ ...e, originalIndex: i })));
    } catch (err) {
      console.error('[MemoryInspector] Failed to load memories:', err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  const handleDelete = async (index: number) => {
    try {
      await window.electronAPI.memory.delete(index, activeProjectId ?? undefined);
      await loadEntries();
    } catch (err) {
      console.error('[MemoryInspector] Delete failed', err);
    }
  };

  const handleSaveEdit = async (index: number) => {
    try {
      await window.electronAPI.memory.update(
        index,
        editContent,
        editCategory,
        activeProjectId ?? undefined
      );
      setEditingIndex(null);
      await loadEntries();
    } catch (err) {
      console.error('[MemoryInspector] Update failed', err);
    }
  };

  const handleAdd = async () => {
    if (!addContent.trim()) return;
    try {
      await window.electronAPI.memory.add(
        addCategory,
        addContent,
        activeProjectId ?? undefined
      );
      setIsAdding(false);
      setAddContent('');
      await loadEntries();
    } catch (err) {
      console.error('[MemoryInspector] Add failed', err);
    }
  };

  const filteredEntries = useMemo(() => {
    let result = entries;
    if (filterCategory) {
      result = result.filter((e) => e.category === filterCategory);
    }
    if (query.trim()) {
      const lower = query.trim().toLowerCase();
      result = result.filter(
        (e) =>
          e.content.toLowerCase().includes(lower) ||
          e.category.toLowerCase().includes(lower)
      );
    }
    // Reverse to show newest first, but originalIndex remains preserved
    return [...result].reverse();
  }, [entries, query, filterCategory]);

  const categories = useMemo(() => {
    const set = new Set<string>(CATEGORIES);
    for (const e of entries) set.add(e.category);
    return Array.from(set);
  }, [entries]);

  if (!activeProjectId) {
    return (
      <div className="p-6 text-center">
        <FileText size={24} className="text-text-muted mx-auto mb-2" />
        <p className="text-sm text-text-muted">{t('memoryBrowser.noMemories', 'No memories for this project')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background text-text-primary">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-muted bg-surface/40">
        <div className="flex items-center gap-2 mb-3">
          <Brain size={14} className="text-accent" />
          <h3 className="text-xs font-semibold uppercase tracking-wider">
            {t('memoryBrowser.title', 'Facts Memory')}
          </h3>
          <div className="ml-auto flex gap-1">
            <button
              data-testid="add-fact-button"
              onClick={() => setIsAdding(true)}
              className="p-1 text-text-muted hover:text-accent transition-colors"
              title="Add Fact"
            >
              <Plus size={14} />
            </button>
            <button
              onClick={loadEntries}
              className="p-1 text-text-muted hover:text-text-primary transition-colors"
              title={t('common.loading', 'Refresh')}
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('memoryBrowser.search', 'Search facts...')}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>

        {/* Category filter */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setFilterCategory(null)}
              className={`text-[10px] px-2 py-0.5 rounded border ${
                filterCategory === null
                  ? 'bg-accent-muted border-accent text-accent'
                  : 'bg-surface border-border text-text-secondary hover:text-text-primary'
              }`}
            >
              All ({entries.length})
            </button>
            {categories.map((cat) => {
              const count = entries.filter((e) => e.category === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={`text-[10px] px-2 py-0.5 rounded border ${
                    filterCategory === cat
                      ? CATEGORY_COLORS[cat] ?? 'bg-accent-muted border-accent text-accent'
                      : 'bg-surface border-border text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {cat} ({count})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Entries List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Add Fact UI */}
        {isAdding && (
          <div className="p-3 rounded-lg bg-surface border border-accent/50 shadow-sm animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-2 mb-2">
              <select
                value={addCategory}
                onChange={(e) => setAddCategory(e.target.value as MemoryCategory)}
                className="text-[10px] bg-background border border-border rounded px-1 py-0.5 outline-none"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <span className="text-[10px] text-accent ml-auto font-medium">NEW FACT</span>
            </div>
            <textarea
              value={addContent}
              onChange={(e) => setAddContent(e.target.value)}
              className="w-full h-20 text-xs bg-background border border-border rounded p-2 text-text-primary focus:outline-none focus:border-accent mb-2"
              placeholder="Fact content..."
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsAdding(false)}
                className="text-[10px] px-2 py-1 rounded border border-border hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                className="text-[10px] px-2 py-1 rounded bg-accent text-accent-contrast hover:opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        )}

        {loading && entries.length === 0 && (
          <div className="text-xs text-text-muted text-center py-4">{t('common.loading')}</div>
        )}

        {!loading && filteredEntries.length === 0 && !isAdding && (
          <div className="text-xs text-text-muted text-center py-4">
            {entries.length === 0 ? t('memoryBrowser.noMemories') : t('memoryBrowser.noMatches')}
          </div>
        )}

        {filteredEntries.map((entry) => {
          const isEditing = editingIndex === entry.originalIndex;

          return (
            <div
              key={entry.originalIndex}
              className={`p-3 rounded-lg border transition-all ${
                isEditing
                  ? 'bg-surface border-accent shadow-sm'
                  : 'bg-surface/40 border-border-muted hover:bg-surface hover:border-border group'
              }`}
            >
              {isEditing ? (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value as MemoryCategory)}
                      className="text-[10px] bg-background border border-border rounded px-1 py-0.5 outline-none"
                    >
                      {categories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full h-20 text-xs bg-background border border-border rounded p-2 text-text-primary focus:outline-none focus:border-accent mb-2"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEditingIndex(null)}
                      className="text-[10px] px-2 py-1 rounded border border-border hover:bg-surface-hover"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleSaveEdit(entry.originalIndex)}
                      className="text-[10px] px-2 py-1 rounded bg-accent text-accent-contrast hover:opacity-90"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 ${
                        CATEGORY_COLORS[entry.category] ??
                        'bg-surface-active text-text-secondary border-border'
                      }`}
                    >
                      <Tag size={10} />
                      {entry.category}
                    </span>
                    {entry.sourceSessionId && (
                      <span className="text-[10px] text-text-muted font-mono truncate">
                        {entry.sourceSessionId.slice(0, 8)}
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-1 text-[10px] text-text-muted">
                      <Clock size={10} />
                      {formatAppDate(entry.timestamp, { dateStyle: 'medium' })}
                    </div>
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed">{entry.content}</p>

                  <div className="flex justify-end gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        setEditingIndex(entry.originalIndex);
                        setEditContent(entry.content);
                        setEditCategory(entry.category as MemoryCategory);
                      }}
                      className="p-1 rounded bg-surface border border-border hover:bg-surface-active text-text-muted hover:text-accent transition-colors"
                      title="Edit Fact"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => handleDelete(entry.originalIndex)}
                      className="p-1 rounded bg-surface border border-border hover:bg-error/20 text-text-muted hover:text-error transition-colors"
                      title="Delete Fact"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
