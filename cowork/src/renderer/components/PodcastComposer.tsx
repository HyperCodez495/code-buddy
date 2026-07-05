/**
 * PodcastComposer — narrated segment surface for Piper local TTS synthesis.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/PodcastComposer
 */

import { useTranslation } from 'react-i18next';
import { Mic2, Play, Radio } from 'lucide-react';
import { estimateAudioLength, type PodSegment } from '../utils/podcast-script';

export interface PodcastComposerProps {
  segments: PodSegment[];
  onSynthesize: (segments: PodSegment[]) => void;
}

export function PodcastComposer({ segments, onSynthesize }: PodcastComposerProps) {
  const { t } = useTranslation();
  const lengthSec = estimateAudioLength(segments);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="podcast-composer">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Radio aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t('genspark.podcast.title', 'Compositeur podcast')}
            </h2>
            <p className="text-xs text-muted-foreground">
              {segments.length} segments · environ {lengthSec}s audio
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label={t('genspark.podcast.synthesize', 'Synthétiser le podcast')}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="podcast-synthesize"
          disabled={segments.length === 0}
          onClick={() => onSynthesize(segments)}
        >
          <Play aria-hidden="true" className="h-4 w-4" />
          {t('genspark.podcast.synthesize', 'Synthétiser')}
        </button>
      </div>

      {segments.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
          {t('genspark.podcast.empty', 'Aucun segment à narrer.')}
        </div>
      ) : (
        <ol className="mt-4 space-y-3">
          {segments.map((segment, index) => (
            <li
              key={segment.id}
              className="rounded-lg border border-border bg-background p-3"
              data-testid={`podcast-segment-${segment.id}`}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium text-foreground">{segment.title}</h3>
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      <Mic2 aria-hidden="true" className="h-3.5 w-3.5" />
                      {segment.voice}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{segment.script}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
