/**
 * Fleet live-load tracker — the missing measurement behind the
 * TaskRouter's 20% load term and the daemon's saturation backpressure.
 *
 * `PeerCapability.activeRequests` existed as a type field but nothing
 * ever populated it, so every peer always looked idle to the router.
 * This module is the process-wide counter of in-flight fleet work:
 * `peer.dispatch` runs, `peer.chat` one-shots, `peer.chat-session`
 * turns, and the autonomous daemon's task executions all register here.
 *
 * Consumers:
 *  - `capability-registry.getLocalCapabilities()` overlays
 *    `activeRequests` live on every call (bypassing its 5-min cache for
 *    that field), so `peer.describe` always reports the real load.
 *  - `heartbeat-broadcaster` carries the load in every beacon so remote
 *    peers can balance without an extra describe round-trip.
 *  - the autonomous loop skips claiming when `utilization ≥ 1`
 *    (backpressure: the shared colab queue then lets an idle peer win
 *    the claim — distributed load balancing without any new RPC).
 *
 * Capacity comes from `CODEBUDDY_FLEET_MAX_CONCURRENCY`; when unset,
 * `utilization` is `null` (unknown), never a fake 0 or 1.
 */

export type FleetWorkKind =
  | 'peer.dispatch'
  | 'peer.chat'
  | 'peer.chat-session'
  | 'autonomy.task';

export interface FleetLoadSnapshot {
  /** Total in-flight fleet work units right now. */
  activeRequests: number;
  /** In-flight count per work kind (only kinds currently > 0). */
  byKind: Partial<Record<FleetWorkKind, number>>;
  /** Configured capacity (CODEBUDDY_FLEET_MAX_CONCURRENCY), if any. */
  maxConcurrency?: number;
  /** activeRequests / maxConcurrency, or null when no capacity is configured. */
  utilization: number | null;
  /** Highest activeRequests observed since process start (diagnostic). */
  peakActiveRequests: number;
  /** Completed work units since process start (diagnostic). */
  completedCount: number;
}

let active = 0;
let peak = 0;
let completed = 0;
const byKind = new Map<FleetWorkKind, number>();

/** Parse the configured fleet capacity. Invalid/absent → undefined (unknown). */
export function resolveFleetMaxConcurrency(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = env['CODEBUDDY_FLEET_MAX_CONCURRENCY'];
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Register one in-flight unit of fleet work. Returns a `done()` to call
 * when the work finishes (success or failure). Idempotent: calling
 * `done()` twice only decrements once.
 */
export function beginFleetWork(kind: FleetWorkKind): () => void {
  active += 1;
  if (active > peak) peak = active;
  byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    active = Math.max(0, active - 1);
    completed += 1;
    const current = byKind.get(kind) ?? 0;
    if (current <= 1) byKind.delete(kind);
    else byKind.set(kind, current - 1);
  };
}

/** Current load snapshot. Cheap — safe to call from every describe/heartbeat. */
export function getFleetLoad(env: NodeJS.ProcessEnv = process.env): FleetLoadSnapshot {
  const maxConcurrency = resolveFleetMaxConcurrency(env);
  return {
    activeRequests: active,
    byKind: Object.fromEntries(byKind) as Partial<Record<FleetWorkKind, number>>,
    ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
    utilization: maxConcurrency !== undefined ? active / maxConcurrency : null,
    peakActiveRequests: peak,
    completedCount: completed,
  };
}

/**
 * Whether this peer is at (or past) its configured capacity. With no
 * configured capacity the answer is always `false` — saturation
 * backpressure is opt-in via CODEBUDDY_FLEET_MAX_CONCURRENCY.
 */
export function isFleetSaturated(env: NodeJS.ProcessEnv = process.env): boolean {
  const load = getFleetLoad(env);
  return load.utilization !== null && load.utilization >= 1;
}

/** Test-only — reset all counters. */
export function _resetFleetLoadForTests(): void {
  active = 0;
  peak = 0;
  completed = 0;
  byKind.clear();
}
