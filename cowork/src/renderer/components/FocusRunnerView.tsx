/**
 * FocusRunnerView — full-screen single-mission runner surface.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/FocusRunnerView
 */

import { useTranslation } from 'react-i18next';
import { Maximize2, X } from 'lucide-react';
import { clampProgress, formatElapsed, type Mission } from '../utils/mission-model';

export interface FocusRunnerViewProps {
  mission: Mission;
  log: string[];
  onExit: () => void;
}

export function FocusRunnerView({ mission, log, onExit }: FocusRunnerViewProps) {
  const { t } = useTranslation();
  const progress = clampProgress(mission.progress);

  return (
    <section className="flex min-h-[560px] flex-col rounded-lg border border-border bg-surface" data-testid="focus-runner-view">
      <header className="flex items-center gap-3 border-b border-border p-4">
        <div className="rounded-lg bg-primary/15 p-2 text-primary">
          <Maximize2 aria-hidden="true" className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground" title={mission.title}>
            {mission.title}
          </h2>
          <p className="text-xs text-muted-foreground">
            {mission.status} · {mission.model} · {formatElapsed(mission.durationMs)}
          </p>
        </div>
        <button
          type="button"
          aria-label={t('genspark.focus.exit', 'Quitter le focus')}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          data-testid="focus-exit"
          onClick={onExit}
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </header>

      <div className="p-4">
        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
          <span>{t('genspark.focus.progress', 'Progression')}</span>
          <span>{progress}%</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-muted" aria-label={`Progression ${progress}%`}>
          <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto border-t border-border bg-background p-4">
        {log.length === 0 ? (
          <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
            {t('genspark.focus.empty', 'Aucune entrée de log.')}
          </div>
        ) : (
          <ol className="space-y-2">
            {log.map((entry, index) => (
              <li key={`${index}-${entry}`} className="rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
                {entry}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
