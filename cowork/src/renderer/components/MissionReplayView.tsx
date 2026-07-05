/**
 * MissionReplayView — seekable run replay timeline.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/MissionReplayView
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { buildTimeline, type RunEvent, type TimelineMark } from '../utils/replay-model';

export interface MissionReplayViewProps {
  events: RunEvent[];
  onSeek: (mark: TimelineMark) => void;
}

function formatReplayTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function MissionReplayView({ events, onSeek }: MissionReplayViewProps) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const timeline = buildTimeline(events);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="mission-replay-view">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t('genspark.replay.title', 'Replay mission')}
          </h2>
          <p className="text-xs text-muted-foreground">{events.length} événements rejouables</p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            aria-label={playing ? t('genspark.replay.pause', 'Pause') : t('genspark.replay.play', 'Lire')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            data-testid="replay-toggle"
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? <Pause aria-hidden="true" className="h-4 w-4" /> : <Play aria-hidden="true" className="h-4 w-4" />}
          </button>
          <button
            type="button"
            aria-label={t('genspark.replay.reset', 'Revenir au début')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="replay-reset"
            disabled={timeline.length === 0}
            onClick={() => {
              if (timeline[0]) onSeek(timeline[0]);
            }}
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>

      {timeline.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
          {t('genspark.replay.empty', 'Aucun événement à rejouer.')}
        </div>
      ) : (
        <ol className="mt-4 space-y-2">
          {timeline.map((mark) => (
            <li key={mark.id}>
              <button
                type="button"
                aria-label={`Aller à ${mark.label}`}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                data-testid={`replay-mark-${mark.id}`}
                onClick={() => onSeek(mark)}
              >
                <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{formatReplayTime(mark.atMs)}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{mark.type}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={mark.label}>
                  {mark.label}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
