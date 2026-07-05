import { ChevronLeft, ChevronRight, Presentation } from 'lucide-react';

import { EmptyState } from '../ui/EmptyState.js';
import { buildSlideDeckViewModel, type SlidePreviewItem } from './slide-deck-preview-model.js';

export interface SlideDeckPreviewProps {
  slides: SlidePreviewItem[];
  activeIndex?: number;
  onSelect?: (index: number) => void;
}

export function SlideDeckPreview({ slides, activeIndex, onSelect }: SlideDeckPreviewProps) {
  const model = buildSlideDeckViewModel(slides, activeIndex);
  const activeSlide = model.slides[model.activeIndex];

  if (model.isEmpty || !activeSlide) {
    return <EmptyState icon={<Presentation className="h-6 w-6" />} title="Deck vide" hint="Aucune slide à prévisualiser pour le moment." />;
  }

  return (
    <section className="grid gap-4 rounded-lg border border-border bg-surface p-4 lg:grid-cols-[16rem_minmax(0,1fr)]" aria-label="Aperçu du deck">
      <aside className="overflow-x-auto lg:max-h-[32rem] lg:overflow-y-auto" aria-label="Vignettes des slides">
        <ol className="flex gap-3 lg:flex-col" role="listbox" aria-label="Slides">
          {model.slides.map((slide) => {
            const selected = slide.index === model.activeIndex;
            return (
              <li key={slide.index} className="min-w-52 lg:min-w-0">
                <button type="button" className={selected ? 'w-full rounded-md border border-primary bg-muted p-3 text-left text-foreground' : 'w-full rounded-md border border-border bg-background p-3 text-left text-muted-foreground hover:text-foreground'} role="option" aria-selected={selected} onClick={() => onSelect?.(slide.index)}>
                  <span className="text-xs tabular-nums">{slide.index + 1}</span>
                  <span className="mt-2 block truncate text-sm font-medium">{slide.title}</span>
                  <span className="mt-1 block line-clamp-2 text-xs">{slide.summary}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>

      <article className="flex min-h-80 flex-col rounded-lg border border-border bg-background p-6" aria-label="Slide active">
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground tabular-nums">Slide {model.activeIndex + 1} / {model.slides.length}</span>
          <div className="flex gap-2">
            <button type="button" className="rounded-md border border-border px-2 py-1 text-sm text-foreground disabled:opacity-40" aria-label="Slide précédente" disabled={model.previousIndex === null} onClick={() => model.previousIndex !== null && onSelect?.(model.previousIndex)}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" className="rounded-md border border-border px-2 py-1 text-sm text-foreground disabled:opacity-40" aria-label="Slide suivante" disabled={model.nextIndex === null} onClick={() => model.nextIndex !== null && onSelect?.(model.nextIndex)}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <h2 className="text-2xl font-semibold tracking-tight text-foreground">{activeSlide.title}</h2>
        {activeSlide.bullets.length > 0 ? (
          <ul className="mt-6 space-y-3 text-sm text-foreground">
            {activeSlide.bullets.map((bullet, index) => <li key={index} className="flex gap-3"><span aria-hidden="true">•</span><span>{bullet}</span></li>)}
          </ul>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">Aucune puce renseignée.</p>
        )}
        {activeSlide.notes && <p className="mt-auto pt-6 text-xs text-muted-foreground">Notes : {activeSlide.notes}</p>}
      </article>
    </section>
  );
}
