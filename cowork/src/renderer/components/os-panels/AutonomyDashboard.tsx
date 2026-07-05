import { Pause, ShieldCheck, Zap } from 'lucide-react';
import { Pill } from '../ui/Pill.js';
import { SectionCard } from '../ui/SectionCard.js';
import { StatTile } from '../ui/StatTile.js';
import { summarizeAutonomy, type AutonomyPosture } from './autonomy-dashboard-model.js';

export interface AutonomyDashboardProps {
  posture: AutonomyPosture;
  running: number;
  queued: number;
  costUsd: number;
  capUsd: number;
  turns: number;
  maxTurns: number;
  onSetPosture?: (posture: AutonomyPosture) => void;
  onPause?: () => void;
}

const postures: AutonomyPosture[] = ['plan', 'dontAsk', 'bypass'];

export function AutonomyDashboard(props: AutonomyDashboardProps) {
  const summary = summarizeAutonomy(props);

  return (
    <SectionCard
      title="Autonomie agentique"
      description="Posture, charge et garde-fous de la session."
      actions={<Pill tone={summary.postureTone}>{summary.postureLabel}</Pill>}
    >
      <div className="grid gap-3 md:grid-cols-3">
        {summary.metrics.map((metric) => (
          <StatTile key={metric.label} label={metric.label} value={metric.value} hint={metric.hint} tone={metric.tone} />
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {summary.gauges.map((gauge) => (
          <div key={gauge.label}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-foreground">{gauge.label}</span>
              <span className="tabular-nums text-muted-foreground">{gauge.value}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={'h-full rounded-full '+(gauge.tone === 'danger' ? 'bg-destructive' : gauge.tone === 'warning' ? 'bg-warning' : 'bg-success')}
                style={{ width: String(gauge.percent) + '%' }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {postures.map((posture) => (
          <button
            key={posture}
            type="button"
            onClick={() => props.onSetPosture?.(posture)}
            className={'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium '+(props.posture === posture ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface text-foreground hover:bg-muted')}
          >
            {posture === 'plan' ? <ShieldCheck className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
            {posture === 'plan' ? 'Plan' : posture === 'dontAsk' ? 'Dont ask' : 'Bypass'}
          </button>
        ))}
        <button
          type="button"
          onClick={props.onPause}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          <Pause className="h-3.5 w-3.5" />
          Pause
        </button>
      </div>
    </SectionCard>
  );
}
