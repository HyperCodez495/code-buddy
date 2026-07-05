/**
 * WorkerDashboard — 24/7 AI employee status surface.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/WorkerDashboard
 */

import { useTranslation } from 'react-i18next';
import { Activity, BriefcaseBusiness, Clock3, Gauge, Server } from 'lucide-react';
import { formatUptime, healthLabel, type WorkerStatus } from '../utils/worker-status';

export interface WorkerDashboardProps {
  status: WorkerStatus;
}

function healthClasses(label: ReturnType<typeof healthLabel>): string {
  if (label === 'ok') return 'bg-success/15 text-success';
  if (label === 'busy') return 'bg-warning/15 text-warning';
  return 'bg-destructive/15 text-destructive';
}

export function WorkerDashboard({ status }: WorkerDashboardProps) {
  const { t } = useTranslation();
  const health = healthLabel(status);
  const load = status.capacity > 0 ? Math.round(((status.activeMissions + status.queuedMissions) / status.capacity) * 100) : 0;

  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-testid="worker-dashboard">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <div className="rounded-lg bg-primary/15 p-2 text-primary">
          <Server aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t('genspark.worker.title', 'Employé IA 24/7')}
          </h2>
          <p className="text-xs text-muted-foreground">{t('genspark.worker.subtitle', 'Supervision continue des missions')}</p>
        </div>
        <span className={`ml-auto rounded-full px-2 py-1 text-xs font-medium ${healthClasses(health)}`}>
          {health}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-background p-3">
          <Clock3 aria-hidden="true" className="mb-2 h-4 w-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">{t('genspark.worker.uptime', 'Uptime')}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{formatUptime(status.uptimeSec)}</p>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <Activity aria-hidden="true" className="mb-2 h-4 w-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">{t('genspark.worker.active', 'Actives')}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{status.activeMissions}</p>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <BriefcaseBusiness aria-hidden="true" className="mb-2 h-4 w-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">{t('genspark.worker.processed', 'Traitées aujourd’hui')}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{status.processedToday}</p>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <Gauge aria-hidden="true" className="mb-2 h-4 w-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">{t('genspark.worker.saturation', 'Saturation')}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{load}%</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
          <span>{t('genspark.worker.queue', 'File + actives')}</span>
          <span>
            {status.activeMissions + status.queuedMissions}/{status.capacity}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-label={`Saturation ${load}%`}>
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, load)}%` }} />
        </div>
      </div>
    </section>
  );
}
