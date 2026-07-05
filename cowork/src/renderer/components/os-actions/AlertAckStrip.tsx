import { Bell, Clock, Send } from 'lucide-react';

import { Pill } from '../ui/Pill.js';
import { ackableWithin, sortBySeverity, type OsAlert } from './utils/alert-model.js';

export interface AlertAckStripAlert extends OsAlert {
  title: string;
  summary: string;
}

export interface AlertAckStripProps {
  alerts: AlertAckStripAlert[];
  now: number;
  onAck: (alertId: string) => void;
  onSnooze: (alertId: string) => void;
  onEscalate: (alertId: string) => void;
}

function tone(severity: AlertAckStripAlert['severity']) {
  if (severity === 'critical') return 'danger' as const;
  if (severity === 'warning') return 'warning' as const;
  return 'info' as const;
}

export function AlertAckStrip({ alerts, now, onAck, onSnooze, onEscalate }: AlertAckStripProps) {
  const sorted = sortBySeverity(alerts) as AlertAckStripAlert[];

  return (
    <section className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <Bell className="h-4 w-4 text-primary" /> Alertes OS
      </div>
      <div className="space-y-2">
        {sorted.map((alert) => {
          const canAck = ackableWithin(alert, now);
          return (
            <div key={alert.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{alert.title}</span>
                  <Pill tone={tone(alert.severity)}>{alert.severity}</Pill>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{alert.summary}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={!canAck} onClick={() => onAck(alert.id)} className="rounded-lg border border-border px-3 py-1 text-xs disabled:opacity-50">Ack</button>
                <button type="button" onClick={() => onSnooze(alert.id)} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-xs"><Clock className="h-3 w-3" /> Snooze</button>
                <button type="button" onClick={() => onEscalate(alert.id)} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1 text-xs"><Send className="h-3 w-3" /> Escalade</button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
