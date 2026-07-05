/**
 * ImagePromptStudio — controlled gallery plus prompt composer for image generation.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/ImagePromptStudio
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageIcon, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { buildImagePrompt, type ImagePreset, type ImageResult } from '../utils/image-preset';

export interface ImagePromptStudioProps {
  presets: ImagePreset[];
  results: ImageResult[];
  onGenerate: (prompt: string, preset: ImagePreset) => void;
}

function statusLabel(status: ImageResult['status']): string {
  if (status === 'queued') return 'En file';
  if (status === 'rendering') return 'Rendu';
  if (status === 'failed') return 'Échec';
  return 'Terminé';
}

export function ImagePromptStudio({ presets, results, onGenerate }: ImagePromptStudioProps) {
  const { t } = useTranslation();
  const [basePrompt, setBasePrompt] = useState('');
  const [selectedId, setSelectedId] = useState(presets[0]?.id ?? '');
  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedId) ?? presets[0],
    [presets, selectedId]
  );
  const finalPrompt = selectedPreset ? buildImagePrompt(basePrompt, selectedPreset) : '';
  const canGenerate = !!selectedPreset && basePrompt.trim().length > 0;

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="image-prompt-studio">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Wand2 aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t('genspark.image.title', 'Studio image')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {presets.length} presets · {results.length} résultats
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label={t('genspark.image.generate', 'Générer une image')}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="image-generate"
          disabled={!canGenerate}
          onClick={() => {
            if (selectedPreset) onGenerate(finalPrompt, selectedPreset);
          }}
        >
          <Sparkles aria-hidden="true" className="h-4 w-4" />
          {t('genspark.image.generate', 'Générer')}
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-3">
          <label className="block text-xs font-medium text-muted-foreground" htmlFor="image-base-prompt">
            {t('genspark.image.prompt', 'Prompt de base')}
          </label>
          <textarea
            id="image-base-prompt"
            className="min-h-28 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            data-testid="image-base-prompt"
            placeholder={t('genspark.image.placeholder', 'Décris précisément le sujet à créer...')}
            value={basePrompt}
            onChange={(event) => setBasePrompt(event.target.value)}
          />

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">{t('genspark.image.presets', 'Presets')}</p>
            <div className="grid grid-cols-2 gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={preset.id === selectedPreset?.id}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    preset.id === selectedPreset?.id
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                  data-testid={`image-preset-${preset.id}`}
                  onClick={() => setSelectedId(preset.id)}
                >
                  <span className="block font-medium">{preset.label}</span>
                  <span className="block text-[11px] opacity-80">
                    {preset.style} · {preset.ratio}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{t('genspark.image.finalPrompt', 'Prompt final')}</p>
            <p className="text-xs text-foreground">{finalPrompt || t('genspark.image.finalEmpty', 'Sélectionne un preset et écris un prompt.')}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {results.length === 0 ? (
            <div className="flex min-h-52 items-center justify-center rounded-lg border border-border bg-background text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
              <ImageIcon aria-hidden="true" className="mr-2 h-5 w-5" />
              {t('genspark.image.empty', 'Aucun rendu pour le moment.')}
            </div>
          ) : (
            results.map((result) => (
              <article
                key={result.id}
                className="overflow-hidden rounded-lg border border-border bg-background"
                data-testid={`image-result-${result.id}`}
              >
                <div className="flex aspect-square items-center justify-center bg-muted">
                  {result.imageUrl ? (
                    <img className="h-full w-full object-cover" src={result.imageUrl} alt={result.prompt} />
                  ) : result.status === 'rendering' ? (
                    <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-muted-foreground" />
                  ) : (
                    <ImageIcon aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <div className="space-y-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {statusLabel(result.status)}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground" title={result.prompt}>
                    {result.prompt}
                  </p>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
