/**
 * Fleet heartbeat broadcaster (Phase (d).9 V0.4.1).
 *
 * Fires `fleet:peer:heartbeat` periodically so remote FleetListener
 * clients know the peer is still alive even when nothing else has
 * happened — closes the "silent peer" UX gap left by Phase (d).5.
 * Patterned after OpenClaw's `node.presence.alive` event but adapted
 * to our mesh broadcast shape (one source, many listeners on /ws).
 *
 * Default interval is 30 seconds. The timer is `unref()`'d so it
 * never blocks process exit. Singleton: a second start() while one
 * is already running is a no-op (idempotent boot).
 *
 * Why a separate module rather than inlining in fleet-bridge.ts:
 * - Lets the broadcast event-type contract stay pure (fleet-bridge
 *   describes WHAT can be sent; this module decides WHEN).
 * - Future hook for instrumentation: agent runtime can pass
 *   `idleSince` / `busyWith` in via a setter so the heartbeat
 *   payload becomes more informative without changing the wire
 *   format.
 */

import { broadcastFleetHeartbeat } from '../server/websocket/fleet-bridge.js';
import { logger } from '../utils/logger.js';

const DEFAULT_INTERVAL_MS = 30_000;

let timer: NodeJS.Timeout | null = null;
let activeIntervalMs: number | null = null;

/**
 * Start emitting periodic presence beacons. Returns a stop function
 * that cancels the timer. Idempotent: a second call while running is
 * a no-op (returns the same logical stop). Caller in `startServer()`
 * doesn't need to track this — `stopFleetHeartbeat()` works globally.
 */
export function startFleetHeartbeat(intervalMs: number = DEFAULT_INTERVAL_MS): () => void {
  if (timer !== null) {
    logger.debug('[fleet-heartbeat] start() called while already running — no-op', {
      currentIntervalMs: activeIntervalMs,
    });
    return stopFleetHeartbeat;
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    intervalMs = DEFAULT_INTERVAL_MS;
  }
  activeIntervalMs = intervalMs;
  timer = setInterval(() => {
    try {
      broadcastFleetHeartbeat();
    } catch (err) {
      // Best-effort — broadcast helper already swallows server-not-running,
      // this catch handles any future failure mode without crashing the
      // event loop.
      logger.debug('[fleet-heartbeat] beacon emit failed (ignored)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, intervalMs);
  // Don't keep the process alive just for this timer — process exit
  // semantics should depend on the server, not on a periodic beacon.
  timer.unref();
  logger.debug('[fleet-heartbeat] started', { intervalMs });
  return stopFleetHeartbeat;
}

/**
 * Cancel the active heartbeat timer if any. Idempotent.
 */
export function stopFleetHeartbeat(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
  activeIntervalMs = null;
  logger.debug('[fleet-heartbeat] stopped');
}

/** Whether a heartbeat timer is currently active. */
export function isFleetHeartbeatActive(): boolean {
  return timer !== null;
}

/** The configured interval of the active timer, or null when stopped. */
export function getFleetHeartbeatIntervalMs(): number | null {
  return activeIntervalMs;
}

/** Test-only reset hook — clears any active timer and the cached interval. */
export function _stopHeartbeatForTests(): void {
  stopFleetHeartbeat();
}
