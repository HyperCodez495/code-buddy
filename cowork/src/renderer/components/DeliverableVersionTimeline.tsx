/**
 * DeliverableVersionTimeline — version history and restore/diff actions.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/DeliverableVersionTimeline
 */

import { useTranslation } from 'react-i18next';
import { Clock3, GitCompareArrows, RotateCcw } from 'lucide-react';
import { diffSummary, type DeliverableVersion } from '../utils/version-model';

export interface DeliverableVersionTimelineProps {
  versions: DeliverableVersion[];
  onRestore: (version: DeliverableVersion) => void;
  onDiff: (from: DeliverableVersion, to: DeliverableVersion) => void;
}

function formatVersionDate(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return 'date inconnue';
  return new Date(ts).toLocaleString();
}

export function DeliverableVersionTimeline({ versions, onRestore, onDiff }: DeliverableVersionTimelineProps) {
  const { t } = useTranslation();
  const ordered = [...versions].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="deliverable-version-timeline">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <div className="rounded-lg bg-primary/15 p-2 text-primary">
          <Clock3 aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t('genspark.versions.title', 'Versions du livrable')}
          </h2>
          <p className="text-xs text-muted-foreground">{versions.length} versions enregistrées</p>
        </div>
      </div>

      {ordered.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
          {t('genspark.versions.empty', 'Aucune version disponible.')}
        </div>
      ) : (
        <ol className="mt-4 space-y-3">
          {ordered.map((version, index) => {
            const previous = ordered[index + 1];
            const diff = previous ? diffSummary(previous, version) : null;

            return (
              <li
                key={version.id}
                className="rounded-lg border border-border bg-background p-3"
                data-testid={`deliverable-version-${version.id}`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium text-foreground">{version.label}</h3>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {formatVersionDate(version.createdAt)}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {version.author}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{version.summary}</p>
                    {diff && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        +{diff.added} · -{diff.removed} · {diff.changed} modifiés
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 justify-end gap-2">
                    {previous && (
                      <button
                        type="button"
                        aria-label={t('genspark.versions.diff', 'Comparer')}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        data-testid={`version-diff-${version.id}`}
                        onClick={() => onDiff(previous, version)}
                      >
                        <GitCompareArrows aria-hidden="true" className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={t('genspark.versions.restore', 'Restaurer')}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      data-testid={`version-restore-${version.id}`}
                      onClick={() => onRestore(version)}
                    >
                      <RotateCcw aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
