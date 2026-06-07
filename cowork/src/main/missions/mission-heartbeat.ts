/**
 * Mission Orchestrator — proactive per-mission heartbeat (roadmap §2.3).
 *
 * A heartbeat lets the orchestrator periodically "wake up" on each active
 * mission to check progress, post a proactive update, detect a stall, or run a
 * background step — the proactivity the roadmap calls for ("works even when
 * you're not there"). This module is the PURE scheduling brain: which missions
 * are *due* for a heartbeat at a given instant.
 *
 * By design it has NO real timer. An external scheduler (the future IPC /
 * Electron layer) calls {@link MissionHeartbeat.tick} on whatever cadence it
 * wants. Keeping the timer out of here makes the logic deterministic and
 * testable, and avoids coupling to Electron.
 *
 * The "last heartbeat" instant is derived from the mission's own event log
 * (its most recent `heartbeat` event), so this needs NO schema change to the
 * {@link Mission} type — purely additive.
 *
 * @module cowork/main/missions/mission-heartbeat
 */

import { Mission, MissionStatus, Clock, isTerminalStatus } from './mission-types.js';
import type { MissionManager } from './mission-manager.js';

/** Event `type` used for heartbeat entries in a mission's activity log. */
export const HEARTBEAT_EVENT_TYPE = 'heartbeat';

/** Default heartbeat cadence: every 15 minutes (roadmap §2.3 suggestion). */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;

/**
 * A mission is heartbeat-active when it could make autonomous progress: not
 * terminal, not paused, and not blocked waiting on a human. (Paused and
 * waiting-for-approval missions are deliberately idle, so we don't beat them.)
 */
export function isHeartbeatActive(mission: Mission): boolean {
  return (
    !isTerminalStatus(mission.status) &&
    mission.status !== MissionStatus.Paused &&
    mission.status !== MissionStatus.WaitingApproval
  );
}

/** ISO timestamp of a mission's most recent `heartbeat` event, if any. */
export function lastHeartbeatAt(mission: Mission): string | undefined {
  for (let i = mission.events.length - 1; i >= 0; i--) {
    const ev = mission.events[i];
    if (ev && ev.type === HEARTBEAT_EVENT_TYPE) return ev.ts;
  }
  return undefined;
}

/**
 * Pure: of `missions`, which heartbeat-active ones are due at `now` — i.e.
 * their last heartbeat (or, if never beaten, their creation time) is at least
 * `intervalMs` old. `lastBeat` is injectable for testing.
 */
export function selectDueMissions(
  missions: readonly Mission[],
  now: string,
  intervalMs: number,
  lastBeat: (m: Mission) => string | undefined = lastHeartbeatAt,
): Mission[] {
  const nowMs = Date.parse(now);
  return missions.filter((m) => {
    if (!isHeartbeatActive(m)) return false;
    const ref = lastBeat(m) ?? m.createdAt;
    return nowMs - Date.parse(ref) >= intervalMs;
  });
}

/** Options for {@link MissionHeartbeat}. */
export interface MissionHeartbeatOptions {
  manager: MissionManager;
  /** Injected ISO-8601 clock; defaults to wall-clock time. */
  clock?: Clock;
  /** Heartbeat cadence in ms (default 15 min). */
  intervalMs?: number;
}

/**
 * Drives proactive heartbeats over a {@link MissionManager}. Has NO internal
 * timer by design — an external scheduler calls {@link tick}. Each due mission
 * gets a recorded `heartbeat` event (streamed to the Mission Board) and a
 * `mission:heartbeat` signal is emitted on the manager's event bus so the
 * orchestrator / IPC layer can react (check progress, post an update, …).
 */
export class MissionHeartbeat {
  private readonly manager: MissionManager;
  private readonly clock: Clock;
  readonly intervalMs: number;

  constructor(options: MissionHeartbeatOptions) {
    this.manager = options.manager;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  }

  /** Missions due for a heartbeat at `now` (no side effects). */
  due(now: string = this.clock()): Mission[] {
    return selectDueMissions(this.manager.listMissions(), now, this.intervalMs);
  }

  /**
   * Fire one heartbeat pass: record a `heartbeat` event on every due mission
   * and emit `mission:heartbeat` for each. Returns the missions that beat.
   * Call this from an external scheduler (timer / IPC) — it never sets its own.
   */
  async tick(now: string = this.clock()): Promise<Mission[]> {
    const due = this.due(now);
    for (const m of due) {
      await this.manager.recordEvent(m.id, {
        type: HEARTBEAT_EVENT_TYPE,
        message: 'Heartbeat: proactive mission check.',
        data: { at: now },
        ts: now,
      });
      this.manager.emit('mission:heartbeat', m.id);
    }
    return due;
  }
}
