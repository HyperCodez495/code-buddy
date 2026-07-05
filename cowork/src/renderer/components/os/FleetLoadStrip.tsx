import { Gauge } from 'lucide-react';

import { Pill } from '../ui/Pill.js';
import { SectionCard } from '../ui/SectionCard.js';
import { formatUtilization, saturationLevel, type FleetLoad } from './util/fleet-load-model.js';

export interface FleetLoadStripProps {
  load: FleetLoad;
}

const levelLabel = {
  idle: 'Repos',
  nominal: 'Nominal',
  saturated: 'Saturé',
};

export function FleetLoadStrip({ load }: FleetLoadStripProps) {
  const level = saturationLevel(load);
  const tone = level === 'saturated' ? 'danger' : level === 'idle' ? 'default' : 'success';
  const utilization = Math.max(0, Math.min(1, load.utilization));
  const backpressure = Math.max(0, Math.min(1, load.backpressure));

  return (
    <SectionCard title="Charge flotte" description="Saturation globale, file d'attente et backpressure du routeur.">
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-3 md:w-56">
          <div className="rounded-full bg-primary/10 p-2 text-primary"><Gauge className="h-5 w-5" /></div>
          <div>
            <Pill tone={tone}>{levelLabel[level]}</Pill>
            <div className="mt-1 text-xs text-muted-foreground">{load.running}/{load.capacity} exécutions</div>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Utilisation</span><span className="tabular-nums">{formatUtilization(utilization)}</span></div>
            <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: formatUtilization(utilization) }} /></div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Backpressure</span><span className="tabular-nums">{formatUtilization(backpressure)}</span></div>
            <div className="h-2 rounded-full bg-muted"><div className={level === 'saturated' ? 'h-2 rounded-full bg-red-500' : 'h-2 rounded-full bg-amber-500'} style={{ width: formatUtilization(backpressure) }} /></div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm tabular-nums md:w-44">
          <div className="rounded-lg bg-muted p-2"><div className="text-muted-foreground">File</div><div className="font-semibold text-foreground">{load.queued}</div></div>
          <div className="rounded-lg bg-muted p-2"><div className="text-muted-foreground">Cap</div><div className="font-semibold text-foreground">{load.capacity}</div></div>
        </div>
      </div>
    </SectionCard>
  );
}
