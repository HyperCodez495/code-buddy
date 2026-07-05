/**
 * MissionResumeMenu — checkpoint selection surface for resume or branch actions.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/MissionResumeMenu
 */

import { useTranslation } from 'react-i18next';
import { CheckCircle2, Clock3, GitBranch, RotateCcw, XCircle } from 'lucide-react';
import { pickLatestStable, type Checkpoint } from '../utils/checkpoint-model';

export interface MissionResumeMenuProps {
  checkpoints: Checkpoint[];
  onResume: (checkpoint: Checkpoint) => void;
  onBranch: (checkpoint: Checkpoint) => void;
}

function statusIcon(status: Checkpoint['status']) {
  if (status === 'stable') return <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-success" />;
  if (status === 'failed') return <XCircle aria-hidden="true" className="h-4 w-4 text-destructive" />;
  return <Clock3 aria-hidden="true" className="h-4 w-4 text-muted-foreground" />;
}

function statusLabel(status: Checkpoint['status']): string {
  if (status === 'stable') return 'Stable';
  if (status === 'failed') return 'Échec';
  return 'Brouillon';
}

function formatCheckpointDate(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return 'Date inconnue';
  return new Date(ts).toLocaleString();
}

export function MissionResumeMenu({ checkpoints, onResume, onBranch }: MissionResumeMenuProps) {
  const { t } = useTranslation();
  const latestStable = pickLatestStable(checkpoints);
  const ordered = [...checkpoints].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="mission-resume-menu">
      <div className="flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t('genspark.checkpoints.title', 'Reprendre une mission')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {latestStable
              ? `Dernier point stable : ${latestStable.label}`
              : t('genspark.checkpoints.noStable', 'Aucun checkpoint stable disponible.')}
          </p>
        </div>
        {latestStable && (
          <button
            type="button"
            aria-label={t('genspark.checkpoints.resumeLatest', 'Reprendre le dernier checkpoint stable')}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            data-testid="checkpoint-resume-latest"
            onClick={() => onResume(latestStable)}
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            {t('genspark.checkpoints.resumeLatest', 'Reprendre ici')}
          </button>
        )}
      </div>

      {ordered.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
          {t('genspark.checkpoints.empty', 'Aucun checkpoint enregistré.')}
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {ordered.map((checkpoint) => {
            const isStable = checkpoint.status === 'stable';

            return (
              <li
                key={checkpoint.id}
                className="rounded-lg border border-border bg-background p-3"
                data-testid={`checkpoint-row-${checkpoint.id}`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="flex min-w-0 flex-1 gap-3">
                    <div className="mt-0.5">{statusIcon(checkpoint.status)}</div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-medium text-foreground" title={checkpoint.label}>
                          {checkpoint.label}
                        </h3>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {statusLabel(checkpoint.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{formatCheckpointDate(checkpoint.createdAt)}</p>
                      {checkpoint.summary && (
                        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground" title={checkpoint.summary}>
                          {checkpoint.summary}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 justify-end gap-2">
                    <button
                      type="button"
                      aria-label={t('genspark.checkpoints.resume', 'Reprendre ce checkpoint')}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid={`checkpoint-resume-${checkpoint.id}`}
                      disabled={!isStable}
                      onClick={() => onResume(checkpoint)}
                    >
                      <RotateCcw aria-hidden="true" className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={t('genspark.checkpoints.branch', 'Brancher autrement')}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid={`checkpoint-branch-${checkpoint.id}`}
                      disabled={!isStable}
                      onClick={() => onBranch(checkpoint)}
                    >
                      <GitBranch aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
