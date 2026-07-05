/**
 * RoutingVizStrip — compact cost/latency/privacy route decision display.
 *
 * Labels intentionally stay as French defaults in this additive demo component;
 * integration can move them into locale files when the surface is mounted.
 *
 * @module renderer/components/RoutingVizStrip
 */

import { useTranslation } from 'react-i18next';
import { LockKeyhole, Route, Timer, Wallet } from 'lucide-react';
import { formatLatency, privacyFlag, type RouteDecision } from '../utils/routing-model';

export interface RoutingVizStripProps {
  route: RouteDecision;
}

export function RoutingVizStrip({ route }: RoutingVizStripProps) {
  const { t } = useTranslation();
  const privacy = privacyFlag(route);

  return (
    <aside className="rounded-lg border border-border bg-surface p-3" data-testid="routing-viz-strip">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Route aria-hidden="true" className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground" title={route.target}>
              {route.target}
            </h2>
            <p className="truncate text-xs text-muted-foreground" title={route.reason}>
              {route.reason}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <span className="inline-flex items-center justify-center gap-1 rounded-md bg-muted px-2 py-1 text-muted-foreground">
            <Wallet aria-hidden="true" className="h-3.5 w-3.5" />
            ${route.costUsd.toFixed(3)}
          </span>
          <span className="inline-flex items-center justify-center gap-1 rounded-md bg-muted px-2 py-1 text-muted-foreground">
            <Timer aria-hidden="true" className="h-3.5 w-3.5" />
            {formatLatency(route.latencyMs)}
          </span>
          <span
            className={`inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 ${
              privacy === 'warn' ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'
            }`}
          >
            <LockKeyhole aria-hidden="true" className="h-3.5 w-3.5" />
            {t(`genspark.routing.${privacy}`, privacy)}
          </span>
        </div>
      </div>
      {route.peer && <p className="mt-2 text-xs text-muted-foreground">Peer : {route.peer}</p>}
    </aside>
  );
}
