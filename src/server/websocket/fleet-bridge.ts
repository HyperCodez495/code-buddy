/**
 * Fleet event bridge (Phase (d).1 V0.4.1).
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
 * Phase (d).1 scope: WS plumbing only. Agent emit hooks (calling
 * broadcastFleetEvent from CodeBuddyAgent / agent-executor / MAS) are
 * Phase (d).2 — out of scope tonight.
 *
 * Honest deferrals:
 * - Cross-host trust: when a remote Claude connects to this Code Buddy's
 *   /ws endpoint, what credential does it use? Hub-issued JWT vs. shared
 *   apiKey vs. per-spoke key are valid options with different operational
 *   trade-offs. Phase (d).2 picks one.
 * - Backpressure: events are bursty (per tool call). The current
 *   `broadcast()` has no slow-consumer handling — a hung remote could
 *   bloat the underlying ws send buffer. Phase (d).2 / V0.5 add a per-
 *   client send queue with drop-on-overflow.
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
