import { DollarSign, TrendingUp } from 'lucide-react';

import { Pill } from '../ui/Pill.js';
import { capTone, projectedPercent, projectOverrun, type CostProjection } from './utils/cost-cap-model.js';

export interface CostCapEditorProps {
  scope: 'mission' | 'day';
  projection: CostProjection;
  onCapChange: (scope: 'mission' | 'day', capUsd: number) => void;
}

function tone(projection: CostProjection) {
  const value = capTone(projection);
  if (value === 'danger') return 'danger' as const;
  if (value === 'warning') return 'warning' as const;
  return 'success' as const;
}

export function CostCapEditor({ scope, projection, onCapChange }: CostCapEditorProps) {
  const overrun = projectOverrun(projection);
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-primary" /><h3 className="font-semibold text-foreground">Budget {scope}</h3></div>
        <Pill tone={tone(projection)}>{projectedPercent(projection)}%</Pill>
      </div>
      <label className="mt-4 block text-sm text-muted-foreground">Cap ($)
        <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" type="number" min={0} value={projection.capUsd} onChange={(event) => onCapChange(scope, Number(event.target.value))} />
      </label>
      <div className="mt-4 grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
        <span>Actuel: ${projection.currentUsd.toFixed(2)}</span>
        <span className="inline-flex items-center gap-1"><TrendingUp className="h-4 w-4" /> Projeté: ${projection.projectedUsd.toFixed(2)}</span>
        <span>Dépassement: ${overrun.toFixed(2)}</span>
      </div>
    </section>
  );
}
