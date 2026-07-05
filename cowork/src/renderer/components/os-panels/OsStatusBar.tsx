import { Activity } from 'lucide-react';
import { sortStatusItems, type OsStatusItem, type OsStatusTone } from './os-status-bar-model.js';

export interface OsStatusBarProps {
  items: OsStatusItem[];
}

const toneClasses: Record<OsStatusTone, string> = {
  ok: 'border-success/40 bg-success/10 text-success',
  warn: 'border-warning/40 bg-warning/10 text-warning',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
  muted: 'border-border bg-muted text-muted-foreground',
};

const dotClasses: Record<OsStatusTone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  error: 'bg-destructive',
  muted: 'bg-muted-foreground',
};

export function OsStatusBar({ items }: OsStatusBarProps) {
  const normalized = sortStatusItems(items);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface p-2">
      <div className="flex min-w-max items-center gap-2">
        <div className="inline-flex items-center gap-2 px-2 text-xs font-medium text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          OS
        </div>
        {normalized.length === 0 ? (
          <span className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">Aucun statut</span>
        ) : (
          normalized.map((item) => (
            <div key={item.label} className={'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs '+toneClasses[item.tone]}>
              <span className={'h-2 w-2 rounded-full '+dotClasses[item.tone]} />
              <span className="font-medium">{item.label}</span>
              <span className="tabular-nums opacity-90">{item.value}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
