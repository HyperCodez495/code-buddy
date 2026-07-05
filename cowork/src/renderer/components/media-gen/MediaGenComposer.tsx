import { Film, ImageIcon, Loader2, Sparkles } from 'lucide-react';
import type { MediaAspect, MediaMode } from './media-model.js';

export interface MediaGenComposerProps {
  mode: MediaMode;
  prompt: string;
  aspect?: MediaAspect;
  count?: number;
  busy?: boolean;
  onPrompt?: (text: string) => void;
  onMode?: (mode: MediaMode) => void;
  onAspect?: (aspect: MediaAspect) => void;
  onCount?: (count: number) => void;
  onGenerate?: () => void;
}

const ASPECTS: MediaAspect[] = ['1:1', '16:9', '9:16'];
const COUNTS = [1, 2, 4, 8];

export function MediaGenComposer({
  mode,
  prompt,
  aspect = '1:1',
  count = 1,
  busy = false,
  onPrompt,
  onMode,
  onAspect,
  onCount,
  onGenerate,
}: MediaGenComposerProps) {
  const canGenerate = prompt.trim().length > 0 && !busy;

  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-sm" aria-label="Composer média génératif">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Génération image / vidéo</p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">Décris la scène à produire</h2>
          </div>
          <div className="inline-flex rounded-lg border border-border bg-muted p-1" aria-label="Type de média">
            <button
              type="button"
              onClick={() => onMode?.('image')}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition ${
                mode === 'image' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={mode === 'image'}
            >
              <ImageIcon className="h-4 w-4" />
              Image
            </button>
            <button
              type="button"
              onClick={() => onMode?.('video')}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition ${
                mode === 'video' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={mode === 'video'}
            >
              <Film className="h-4 w-4" />
              Vidéo
            </button>
          </div>
        </div>

        <label className="sr-only" htmlFor="media-gen-prompt">
          Prompt de génération
        </label>
        <textarea
          id="media-gen-prompt"
          value={prompt}
          onChange={(event) => onPrompt?.(event.target.value)}
          rows={5}
          placeholder="Ex. Un atelier futuriste chaleureux, lumière douce, rendu cinématique..."
          className="min-h-32 w-full resize-y rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
        />

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2" aria-label="Format">
            <span className="text-xs font-medium text-muted-foreground">Ratio</span>
            {ASPECTS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onAspect?.(option)}
                className={`rounded-full border px-3 py-1 text-xs tabular-nums transition ${
                  aspect === option
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-border bg-surface text-muted-foreground hover:text-foreground'
                }`}
                aria-pressed={aspect === option}
              >
                {option}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            Nombre
            <select
              value={count}
              onChange={(event) => onCount?.(Number(event.target.value))}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
              aria-label="Nombre de résultats"
            >
              {COUNTS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className="ml-auto inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Générer les médias"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Générer
          </button>
        </div>
      </div>
    </section>
  );
}
