/**
 * ShortVideoStoryboard — scene plan surface for text-to-short-video generation.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/ShortVideoStoryboard
 */

import { useTranslation } from 'react-i18next';
import { Clapperboard, Play, Timer } from 'lucide-react';
import { totalDuration, type Scene } from '../utils/storyboard-model';

export interface ShortVideoStoryboardProps {
  scenes: Scene[];
  onRender: (scenes: Scene[]) => void;
}

export function ShortVideoStoryboard({ scenes, onRender }: ShortVideoStoryboardProps) {
  const { t } = useTranslation();
  const duration = totalDuration(scenes);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="short-video-storyboard">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Clapperboard aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t('genspark.video.title', 'Storyboard short vidéo')}
            </h2>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Timer aria-hidden="true" className="h-3.5 w-3.5" />
              {scenes.length} scènes · {duration}s
            </div>
          </div>
        </div>
        <button
          type="button"
          aria-label={t('genspark.video.render', 'Rendre la vidéo')}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="storyboard-render"
          disabled={scenes.length === 0}
          onClick={() => onRender(scenes)}
        >
          <Play aria-hidden="true" className="h-4 w-4" />
          {t('genspark.video.render', 'Rendre')}
        </button>
      </div>

      {scenes.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
          {t('genspark.video.empty', 'Aucune scène dans ce storyboard.')}
        </div>
      ) : (
        <ol className="mt-4 space-y-3">
          {scenes.map((scene, index) => (
            <li
              key={scene.id}
              className="rounded-lg border border-border bg-background p-3"
              data-testid={`storyboard-scene-${scene.id}`}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium text-foreground">{scene.title}</h3>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {scene.durationSec}s
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Visuel : </span>
                    {scene.visual}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Voix : </span>
                    {scene.voiceover}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
