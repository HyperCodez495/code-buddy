/**
 * FleetUtilizationStrip — live load balance across the fleet's actors.
 *
 * Renders each peer's in-flight work against its configured capacity
 * (`activeRequests` / `maxConcurrency`, kept live by the 30s heartbeat
 * beacons via FleetBridge.applyHeartbeatLoad) plus the fleet-wide
 * utilization rate (sum of active / sum of capacity over peers that
 * declared one). Peers without a declared capacity show their raw
 * in-flight count and are excluded from the aggregate — an unknown
 * capacity is reported as unknown, never as a fake 0% or 100%.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import type { FleetPeer } from '../types';

interface PeerLoadRow {
  peerId: string;
  label: string;
  active: number;
  max?: number;
}

function barTone(ratio: number): string {
  if (ratio >= 0.9) return 'bg-error';
  if (ratio >= 0.6) return 'bg-warning';
  return 'bg-success';
}

export function buildPeerLoadRows(peers: FleetPeer[]): PeerLoadRow[] {
  return peers
    .filter((peer) => peer.capability)
    .map((peer) => ({
      peerId: peer.id,
      label: peer.label?.trim() || peer.capability?.machineLabel?.trim() || peer.id,
      active: peer.capability?.activeRequests ?? 0,
      ...(typeof peer.capability?.maxConcurrency === 'number' && peer.capability.maxConcurrency > 0
        ? { max: peer.capability.maxConcurrency }
        : {}),
    }));
}

export function fleetUtilization(rows: PeerLoadRow[]): number | null {
  const withCapacity = rows.filter((row) => row.max !== undefined);
  if (withCapacity.length === 0) return null;
  const totalMax = withCapacity.reduce((sum, row) => sum + (row.max ?? 0), 0);
  if (totalMax <= 0) return null;
  const totalActive = withCapacity.reduce((sum, row) => sum + row.active, 0);
  return totalActive / totalMax;
}

export const FleetUtilizationStrip: React.FC<{ peers: FleetPeer[] }> = ({ peers }) => {
  const { t } = useTranslation();
  const rows = buildPeerLoadRows(peers);
  const utilization = fleetUtilization(rows);

  if (rows.length === 0) return null;

  return (
    <section
      className="rounded border border-border-muted bg-surface/60 px-3 py-2 text-xs"
      data-testid="fleet-utilization-strip"
    >
      <div className="flex items-center gap-2">
        <Gauge size={12} className="text-text-muted shrink-0" />
        <span className="text-[10px] uppercase tracking-wider text-text-muted">
          {t('fleet.utilization.title', 'Fleet utilization')}
        </span>
        {utilization !== null ? (
          <span className="tabular-nums text-text-secondary" data-testid="fleet-utilization-rate">
            {(utilization * 100).toFixed(0)}%
          </span>
        ) : (
          <span className="text-[10px] text-text-muted" data-testid="fleet-utilization-unknown">
            {t('fleet.utilization.unknown', 'capacity not declared (set CODEBUDDY_FLEET_MAX_CONCURRENCY on peers)')}
          </span>
        )}
      </div>
      <ul className="mt-1.5 space-y-1">
        {rows.map((row) => {
          const ratio = row.max !== undefined ? Math.min(1, row.active / row.max) : null;
          return (
            <li key={row.peerId} className="flex items-center gap-2" data-testid="fleet-utilization-row">
              <span className="min-w-0 flex-shrink truncate font-mono text-[10px] text-text-secondary w-32">
                {row.label}
              </span>
              <div className="flex-1 h-1 bg-surface rounded overflow-hidden">
                {ratio !== null && (
                  <div
                    className={`h-full transition-all ${barTone(ratio)}`}
                    style={{ width: `${ratio * 100}%` }}
                  />
                )}
              </div>
              <span className="shrink-0 tabular-nums text-[10px] text-text-muted">
                {row.max !== undefined
                  ? `${row.active}/${row.max}`
                  : t('fleet.utilization.activeOnly', '{{count}} active', { count: row.active })}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
