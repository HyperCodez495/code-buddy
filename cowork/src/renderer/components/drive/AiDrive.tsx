/**
 * AI Drive — a browser of the agent's generated artifacts (Genspark-inspired).
 * Props-driven: search / kind filter / sort come from props, actions via callbacks.
 */
import { Trash2 } from 'lucide-react';
import {
  filterAndSortItems,
  humanSize,
  kindMeta,
  relativeTime,
  type DriveItem,
  type DriveItemKind,
  type DriveSort,
} from './drive-model.js';

const TINT: Record<string, string> = {
  default: 'text-muted-foreground',
  green: 'text-success',
  amber: 'text-warning',
  red: 'text-destructive',
  blue: 'text-accent',
};

export interface AiDriveProps {
  items: DriveItem[];
  query?: string;
  kindFilter?: DriveItemKind | 'all';
  sort?: DriveSort;
  onOpen?: (id: string) => void;
  onDelete?: (id: string) => void;
  onQuery?: (q: string) => void;
  onKindFilter?: (k: DriveItemKind | 'all') => void;
  onSort?: (s: DriveSort) => void;
}

const KINDS: Array<DriveItemKind | 'all'> = ['all', 'slide', 'sheet', 'doc', 'image', 'video', 'report', 'app', 'audio'];

export function AiDrive({
  items,
  query = '',
  kindFilter = 'all',
  sort = 'recent',
  onOpen,
  onDelete,
  onQuery,
  onKindFilter,
  onSort,
}: AiDriveProps) {
  const now = Date.now();
  const visible = filterAndSortItems(items, { query, kind: kindFilter, sort });

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="ai-drive">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <input
          value={query}
          onChange={(event) => onQuery?.(event.target.value)}
          placeholder="Rechercher un artefact…"
          aria-label="Rechercher un artefact"
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <select
          value={kindFilter}
          onChange={(event) => onKindFilter?.(event.target.value as DriveItemKind | 'all')}
          aria-label="Filtrer par type"
          className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k === 'all' ? 'Tous les types' : kindMeta(k).label}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(event) => onSort?.(event.target.value as DriveSort)}
          aria-label="Trier"
          className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none"
        >
          <option value="recent">Récents</option>
          <option value="name">Nom</option>
          <option value="size">Taille</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
          Aucun artefact généré pour l'instant.
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(180px,1fr))] content-start gap-3 overflow-y-auto p-3">
          {visible.map((item) => {
            const meta = kindMeta(item.kind);
            const Icon = meta.icon;
            return (
              <div
                key={item.id}
                className="group relative flex flex-col gap-2 rounded-md border border-border bg-surface p-3 transition-colors hover:border-accent"
              >
                <button type="button" onClick={() => onOpen?.(item.id)} className="flex flex-col gap-2 text-left">
                  <span className="flex h-20 items-center justify-center rounded bg-background">
                    <Icon className={`h-8 w-8 ${TINT[meta.tint]}`} aria-hidden="true" />
                  </span>
                  <span className="truncate text-sm font-medium text-foreground" title={item.name}>
                    {item.name}
                  </span>
                  <span className="flex items-center justify-between gap-2 text-[11px] tabular-nums text-muted-foreground">
                    <span>{meta.label}</span>
                    <span>
                      {relativeTime(item.createdAt, now)}
                      {item.sizeBytes ? ` · ${humanSize(item.sizeBytes)}` : ''}
                    </span>
                  </span>
                </button>
                {onDelete ? (
                  <button
                    type="button"
                    onClick={() => onDelete(item.id)}
                    title="Supprimer"
                    aria-label="Supprimer l'artefact"
                    className="absolute right-2 top-2 hidden rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive group-hover:block"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
