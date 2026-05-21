/**
 * LessonsVaultGraph — P5.7
 *
 * Hierarchical text-based view of the lessons vault. No D3 — just nested
 * sections, grouping lessons by tag, and a search box. Calls the existing
 * lessons-vault preview bridge.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, BookOpen, Search } from 'lucide-react';

interface LessonsVaultGraphProps {
  onClose: () => void;
}

interface LessonEntry {
  id: string;
  title: string;
  tags?: string[];
  summary?: string;
  createdAt?: number;
}

export function LessonsVaultGraph({ onClose }: LessonsVaultGraphProps) {
  const { t } = useTranslation();
  const [lessons, setLessons] = useState<LessonEntry[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const api = (window.electronAPI as unknown as { tools?: { lessonsVault?: { preview?: () => Promise<LessonEntry[]> } } })?.tools?.lessonsVault?.preview;
    if (!api) {
      setLoading(false);
      return;
    }
    api()
      .then((list) => setLessons(list ?? []))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? lessons.filter(
          (l) =>
            l.title.toLowerCase().includes(q) ||
            l.summary?.toLowerCase().includes(q) ||
            l.tags?.some((tg) => tg.toLowerCase().includes(q))
        )
      : lessons;
    const map = new Map<string, LessonEntry[]>();
    for (const lesson of filtered) {
      const tags = lesson.tags?.length ? lesson.tags : ['untagged'];
      for (const tag of tags) {
        if (!map.has(tag)) map.set(tag, []);
        map.get(tag)!.push(lesson);
      }
    }
    return Array.from(map.entries())
      .map(([tag, items]) => ({ tag, items }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [lessons, query]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4" role="dialog" aria-modal="true" data-testid="lessons-vault-graph">
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">{t('lessonsVault.title', 'Lessons vault')}</h2>
            <span className="text-[11px] text-text-muted">{lessons.length} {t('lessonsVault.entries', 'entries')}</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover">
            <X size={14} />
          </button>
        </div>
        <div className="px-5 py-2 border-b border-border-muted">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('lessonsVault.searchPlaceholder', 'Search lessons by title, tag, summary...')}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-surface border border-border-subtle focus:outline-none focus:border-accent"
              data-testid="lessons-vault-search"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && <p className="text-xs text-text-muted">{t('common.loading', 'Loading...')}</p>}
          {!loading && grouped.length === 0 && (
            <p className="text-xs italic text-text-muted text-center py-8">
              {t('lessonsVault.empty', 'No lessons yet. They accumulate as the agent reflects on tool outputs and errors.')}
            </p>
          )}
          {grouped.map((group) => (
            <details key={group.tag} open className="border border-border-subtle rounded-lg">
              <summary className="px-3 py-2 text-xs font-medium cursor-pointer hover:bg-surface-hover flex items-center justify-between">
                <span className="capitalize">{group.tag}</span>
                <span className="text-[10px] text-text-muted">{group.items.length}</span>
              </summary>
              <ul className="px-3 pb-3 space-y-2">
                {group.items.map((item) => (
                  <li key={item.id} className="border-l-2 border-accent/30 pl-2.5 py-1">
                    <div className="text-xs font-medium">{item.title}</div>
                    {item.summary && <p className="text-[11px] text-text-muted mt-0.5">{item.summary}</p>}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
