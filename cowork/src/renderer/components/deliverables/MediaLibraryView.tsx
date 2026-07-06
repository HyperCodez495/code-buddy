/**
 * MediaLibraryView — the full-page « Bibliothèque » rail category: every
 * generated image and video as thumbnails, with per-item reuse/export and a
 * link back to the conversation that produced each one. Wraps the existing
 * MediaLibraryPanel with a titled header (the panel is also embedded as the
 * Médias tab inside Créations).
 */
import { lazy, Suspense } from 'react';
import { ImageIcon, Loader2 } from 'lucide-react';

const MediaLibraryPanel = lazy(() =>
  import('./MediaLibraryPanel.js').then((m) => ({ default: m.MediaLibraryPanel })),
);

export function MediaLibraryView() {
  return (
    <main className="flex h-full min-h-0 flex-col bg-background text-foreground" data-testid="media-library-view">
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
        <ImageIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-sm font-semibold">Bibliothèque</h1>
        <span className="text-xs text-muted-foreground">Images et vidéos générées — clic 💬 pour retrouver la conversation</span>
      </header>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            </div>
          }
        >
          <MediaLibraryPanel />
        </Suspense>
      </div>
    </main>
  );
}
