/**
 * MissionBoard — props-driven view of parallel Cowork missions.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/MissionBoard
 */

import { useTranslation } from 'react-i18next';
import { CirclePause, CirclePlay, Clock3, ExternalLink, Loader2, TimerReset } from 'lucide-react';
import { clampProgress, formatElapsed, summarizeMissions, type Mission } from '../utils/mission-model';

export interface MissionBoardProps {
  missions: Mission[];
  onOpen: (mission: Mission) => void;
  onPause: (mission: Mission) => void;
  onResume: (mission: Mission) => void;
}

const STATUS_LABELS: Record<Mission['status'], string> = {
  queued: 'En file',
  running: 'En cours',
  paused: 'Pause',
  done: 'Terminé',
  failed: 'Échec',
};

function statusTone(status: Mission['status']): string {
  if (status === 'running') return 'bg-primary/15 text-primary';
  if (status === 'done') return 'bg-success/15 text-success';
  if (status === 'failed') return 'bg-destructive/15 text-destructive';
  return 'bg-muted text-muted-foreground';
}

export function MissionBoard({ missions, onOpen, onPause, onResume }: MissionBoardProps) {
  const { t } = useTranslation();
  const summary = summarizeMissions(missions);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="mission-board">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t('genspark.missions.title', 'Missions parallèles')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {summary.running} actives · {summary.queued} en attente · {summary.done} terminées · {summary.failed} en erreur
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-muted px-2 py-1">{missions.length} missions</span>
          <span className="rounded-full bg-muted px-2 py-1">{summary.running} modèles au travail</span>
        </div>
      </div>

      {missions.length === 0 ? (
        <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <TimerReset aria-hidden="true" className="h-5 w-5" />
          <p>{t('genspark.missions.empty', 'Aucune mission en cours.')}</p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {missions.map((mission) => {
            const progress = clampProgress(mission.progress);
            const canPause = mission.status === 'running';
            const canResume = mission.status === 'paused' || mission.status === 'queued' || mission.status === 'failed';

            return (
              <article
                key={mission.id}
                className="rounded-lg border border-border bg-background p-3"
                data-testid={`mission-card-${mission.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-muted p-2 text-muted-foreground">
                    {mission.status === 'running' ? (
                      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                    ) : (
                      <Clock3 aria-hidden="true" className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-foreground" title={mission.title}>
                      {mission.title}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className={`rounded-full px-2 py-0.5 ${statusTone(mission.status)}`}>
                        {STATUS_LABELS[mission.status]}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5">{mission.model}</span>
                      <span>{formatElapsed(mission.durationMs)}</span>
                    </div>
                  </div>
                </div>

                {mission.detail && (
                  <p className="mt-3 line-clamp-2 text-xs text-muted-foreground" title={mission.detail}>
                    {mission.detail}
                  </p>
                )}

                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t('genspark.missions.progress', 'Progression')}</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted" aria-label={`Progression ${progress}%`}>
                    <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    aria-label={t('genspark.missions.open', 'Ouvrir')}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    data-testid={`mission-open-${mission.id}`}
                    onClick={() => onOpen(mission)}
                  >
                    <ExternalLink aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('genspark.missions.pause', 'Mettre en pause')}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid={`mission-pause-${mission.id}`}
                    disabled={!canPause}
                    onClick={() => onPause(mission)}
                  >
                    <CirclePause aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('genspark.missions.resume', 'Reprendre')}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    data-testid={`mission-resume-${mission.id}`}
                    disabled={!canResume}
                    onClick={() => onResume(mission)}
                  >
                    <CirclePlay aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
