/**
 * MobileSupervisionView — compact mission supervision list for mobile channels.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/MobileSupervisionView
 */

import { useTranslation } from 'react-i18next';
import { Check, Smartphone, Square } from 'lucide-react';
import { clampProgress, formatElapsed, type Mission } from '../utils/mission-model';

export type MobileMissionAction = 'approve' | 'stop';

export interface MobileSupervisionViewProps {
  missions: Mission[];
  onAct: (mission: Mission, action: MobileMissionAction) => void;
}

export function MobileSupervisionView({ missions, onAct }: MobileSupervisionViewProps) {
  const { t } = useTranslation();

  return (
    <section className="max-w-sm rounded-lg border border-border bg-surface p-3" data-testid="mobile-supervision-view">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <div className="rounded-lg bg-primary/15 p-2 text-primary">
          <Smartphone aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t('genspark.mobile.title', 'Supervision mobile')}
          </h2>
          <p className="text-xs text-muted-foreground">{missions.length} missions</p>
        </div>
      </div>

      {missions.length === 0 ? (
        <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
          {t('genspark.mobile.empty', 'Aucune mission à superviser.')}
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {missions.map((mission) => {
            const progress = clampProgress(mission.progress);
            return (
              <li
                key={mission.id}
                className="rounded-lg border border-border bg-background p-3"
                data-testid={`mobile-mission-${mission.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium text-foreground" title={mission.title}>
                      {mission.title}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {mission.status} · {mission.model} · {formatElapsed(mission.durationMs)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {progress}%
                  </span>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    aria-label={t('genspark.mobile.approve', 'Valider')}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
                    data-testid={`mobile-approve-${mission.id}`}
                    onClick={() => onAct(mission, 'approve')}
                  >
                    <Check aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('genspark.mobile.stop', 'Stopper')}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    data-testid={`mobile-stop-${mission.id}`}
                    onClick={() => onAct(mission, 'stop')}
                  >
                    <Square aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
