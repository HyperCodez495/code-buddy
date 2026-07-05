/**
 * SlideDeckBuilder — controlled outline editor for AI slide generation.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/SlideDeckBuilder
 */

import { useTranslation } from 'react-i18next';
import { FileText, Pencil, Presentation, Sparkles } from 'lucide-react';
import { outlineToSpeakerNotes, type SlideOutline } from '../utils/slide-outline';

export interface SlideDeckBuilderProps {
  outline: SlideOutline[];
  onGenerate: (outline: SlideOutline[]) => void;
  onEditOutline: (outline: SlideOutline[]) => void;
}

function replaceSlide(outline: SlideOutline[], slideId: string, update: Partial<SlideOutline>): SlideOutline[] {
  return outline.map((slide) => (slide.id === slideId ? { ...slide, ...update } : slide));
}

export function SlideDeckBuilder({ outline, onGenerate, onEditOutline }: SlideDeckBuilderProps) {
  const { t } = useTranslation();
  const notes = outlineToSpeakerNotes(outline);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="slide-deck-builder">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Presentation aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t('genspark.slides.title', 'Générateur de deck')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {outline.length} slides · notes orateur prêtes pour le skill PPTX
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label={t('genspark.slides.generate', 'Générer le deck')}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="slide-deck-generate"
          disabled={outline.length === 0}
          onClick={() => onGenerate(outline)}
        >
          <Sparkles aria-hidden="true" className="h-4 w-4" />
          {t('genspark.slides.generate', 'Générer')}
        </button>
      </div>

      {outline.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground">
          <FileText aria-hidden="true" className="h-5 w-5" />
          {t('genspark.slides.empty', 'Aucun plan de slides fourni.')}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <ol className="space-y-3">
            {outline.map((slide, index) => (
              <li
                key={slide.id}
                className="rounded-lg border border-border bg-background p-3"
                data-testid={`slide-outline-${slide.id}`}
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                    {index + 1}
                  </span>
                  <input
                    aria-label={`Titre slide ${index + 1}`}
                    className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
                    data-testid={`slide-title-${slide.id}`}
                    value={slide.title}
                    onChange={(event) => onEditOutline(replaceSlide(outline, slide.id, { title: event.target.value }))}
                  />
                </div>
                <textarea
                  aria-label={`Bullets slide ${index + 1}`}
                  className="mt-2 min-h-24 w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary"
                  data-testid={`slide-bullets-${slide.id}`}
                  value={slide.bullets.join('\n')}
                  onChange={(event) =>
                    onEditOutline(
                      replaceSlide(outline, slide.id, {
                        bullets: event.target.value
                          .split('\n')
                          .map((line) => line.trim())
                          .filter(Boolean),
                      })
                    )
                  }
                />
              </li>
            ))}
          </ol>

          <aside className="rounded-lg border border-border bg-background p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <Pencil aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              {t('genspark.slides.notes', 'Notes orateur')}
            </div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs text-muted-foreground">
              {notes}
            </pre>
          </aside>
        </div>
      )}
    </section>
  );
}
