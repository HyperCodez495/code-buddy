/**
 * Media generation gallery (Genspark-inspired): a grid of generated images/videos
 * with per-item status (queued / generating / done / error). Props-driven.
 */
import { AlertTriangle, Play, RefreshCw } from 'lucide-react';
import { aspectRatio, statusLabel, type MediaGalleryItem } from './media-model.js';

export interface MediaGalleryProps {
  items: MediaGalleryItem[];
  onSelect?: (id: string) => void;
  onRetry?: (id: string) => void;
}

export function MediaGallery({ items, onSelect, onRetry }: MediaGalleryProps) {
  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        Aucune génération pour l'instant.
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] content-start gap-3 overflow-y-auto p-3"
      data-testid="media-gallery"
    >
      {items.map((item) => {
        const { w, h } = aspectRatio(item.aspect);
        const ratio = `${w} / ${h}`;
        const done = item.status === 'done' && item.url;
        const pending = item.status === 'queued' || item.status === 'generating';

        return (
          <figure
            key={item.id}
            className="group relative m-0 overflow-hidden rounded-md border border-border bg-surface"
          >
            <button
              type="button"
              onClick={() => onSelect?.(item.id)}
              className="block w-full"
              style={{ aspectRatio: ratio }}
              aria-label={item.prompt}
            >
              {done ? (
                item.type === 'video' ? (
                  <video src={item.url} className="h-full w-full object-cover" muted playsInline />
                ) : (
                  <img src={item.url} alt={item.prompt} className="h-full w-full object-cover" />
                )
              ) : pending ? (
                <span className="flex h-full w-full animate-pulse items-center justify-center bg-muted text-[11px] text-muted-foreground">
                  {statusLabel(item.status)}…
                </span>
              ) : (
                <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-background text-destructive">
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                  <span className="text-[11px]">{statusLabel(item.status)}</span>
                </span>
              )}
            </button>

            {item.type === 'video' && done ? (
              <span className="pointer-events-none absolute left-2 top-2 rounded bg-background/70 p-1 text-foreground">
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            ) : null}

            {item.status === 'error' && onRetry ? (
              <button
                type="button"
                onClick={() => onRetry(item.id)}
                title="Réessayer"
                aria-label="Réessayer la génération"
                className="absolute right-2 top-2 rounded bg-background/80 p-1 text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}

            <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
              {item.prompt}
              {item.model ? ` · ${item.model}` : ''}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
