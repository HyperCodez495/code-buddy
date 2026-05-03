/**
 * Fleet event bridge (Phase (d).1 + (d).7 V0.4.1).
 *
 * Lightweight wrapper around the Gateway WebSocket `broadcast()` so the
 * agent runtime can publish live events (tool starts, workflow progress,
 * sub-agent spawns) to other Code Buddy instances on the Tailscale fleet.
 * Receivers must hold the `fleet:listen` scope on their authenticated WS
 * connection — `broadcast(msg, 'fleet:listen')` filters on that.
 *
 * Why a separate module:
 * - Keeps the WS handler.ts focused on connection lifecycle.
 * - Lets agent code import this without pulling the whole WS handler
 *   surface (avoids circular imports through ../../channels/index.js).
 * - Single source of truth for the event-type constants — receivers and
 *   emitters stay in sync.
 *
 * Backpressure (Phase (d).7): the underlying `broadcast()` in handler.ts
 * skips clients whose ws.bufferedAmount has grown past
 * SERVER_CONFIG.WS_BROADCAST_BUFFER_LIMIT (default 2 MiB,
 * env-overridable). Drops are counted per-client and surfaced through
 * `getConnectionStats().totalBroadcastsDropped`. A hung remote can no
 * longer inflate the server's send buffer indefinitely.
 *
 * Honest deferrals (V0.5+):
 * - Cross-host trust: hub-issued JWT vs. shared apiKey vs. per-spoke
 *   key — three valid options with different operational trade-offs.
 *   Caller picks based on operational needs.
 * - Event replay during a slow-consumer drop window: events skipped
 *   because of backpressure are lost (no server-side retention buffer).
 *   Best-effort by design — V0.6+ if a use case demands replay.
 *
 * Follow-up: src/gateway/ws-transport.ts:382 has a structurally identical
 * broadcast() with the same slow-consumer risk. Not in (d).7 scope to
 * keep the diff narrow; mirror this pattern there in a separate ship.
 */

import os from 'os';
import { broadcast } from './handler.js';

/**
 * Event types emitted on the fleet bus. Mirror the names of MAS /
 * agent-executor events so receivers can map them 1:1 to local
 * AgentRuntime events for re-display.
 */
export const FLEET_EVENT_TYPES = [
  'fleet:agent:tool_started',
  'fleet:agent:tool_completed',
  'fleet:agent:tool_error',
  'fleet:agent:reasoning',
  'fleet:workflow:event',
  'fleet:workflow:start',
  'fleet:workflow:complete',
  'fleet:session:spawn',
  'fleet:session:message',
] as const;

export type FleetEventType = (typeof FLEET_EVENT_TYPES)[number];

/**
 * Source identification carried with every fleet event so receivers know
 * which Claude emitted it (essential when one WS client fans in events
 * from multiple peer instances via a hub).
 */
export interface FleetEventSource {
  /** Hostname of the emitting Claude (os.hostname()). */
  hostname: string;
  /** Optional agent identifier — MAS workflowId, session id, or arbitrary
   *  tag set by the emitter. Useful for filtering on the receiving side. */
  agentId?: string;
}

/**
 * Cached source. Resolved lazily on first emit so tests can stub
 * `os.hostname` before any broadcast fires.
 */
let cachedSource: FleetEventSource | null = null;

/** Manually override the source (test helper + future cross-host wiring). */
export function setFleetEventSource(source: FleetEventSource): void {
  cachedSource = source;
}

/** Test reset hook. Forces lazy re-resolution. */
export function _resetFleetEventSourceForTests(): void {
  cachedSource = null;
}

function getSource(agentId?: string): FleetEventSource {
  if (!cachedSource) {
    cachedSource = {
      hostname: process.env.CODEBUDDY_FLEET_HOSTNAME || os.hostname(),
    };
  }
  return agentId ? { ...cachedSource, agentId } : cachedSource;
}

/**
 * Broadcast a fleet event to all WS clients holding the `fleet:listen`
 * scope. Best-effort: silently drops the event if the WS server has not
 * been started (CLI-only mode), so agent code can call this freely
 * without first checking server state.
 *
 * Payload shape is event-specific; the wrapper adds `source` + a
 * timestamp so the wire format is uniform.
 */
export function broadcastFleetEvent(
  type: FleetEventType,
  payload: Record<string, unknown>,
  agentId?: string,
): void {
  try {
    const source = getSource(agentId);
    broadcast(
      {
        type,
        payload: {
          ...payload,
          source,
        },
        timestamp: new Date().toISOString(),
      },
      'fleet:listen',
    );
  } catch {
    // Best-effort: WS server not running (e.g. unit tests, CLI-only mode).
    // We never want a fleet broadcast failure to break the calling agent.
  }
}
