/**
 * Mission Orchestrator — boot recovery (roadmap §2.4 checkpoint / resume).
 *
 * The mission store persists every mutation atomically, so on a crash or a
 * Cowork restart the missions reload from disk via {@link MissionManager.init}.
 * But a mission persisted as `planning`/`running` was actively executing when
 * the process stopped — its in-memory execution is gone. Believing it is still
 * "running" would be a lie. This module decides, purely, which missions were
 * interrupted by the restart and parks them in `paused` (with an audit event)
 * so a human or the orchestrator can deliberately resume them.
 *
 * Already-parked states (`paused`, `waiting_approval`) and terminal states are
 * left untouched — they carry no live in-memory execution to lose.
 *
 * PURE TypeScript: no Electron, no IPC, no timers. {@link planBootRecovery} is
 * a pure decision; {@link applyBootRecovery} applies it through the manager's
 * existing public API only (no new coupling, additive by design).
 *
 * @module cowork/main/missions/mission-recovery
 */

import { Mission, MissionStatus, isTerminalStatus } from './mission-types.js';
import type { MissionManager } from './mission-manager.js';

/**
 * Statuses that mean a mission had live in-memory execution when the process
 * died, and therefore must be reconciled on the next boot.
 */
export const INTERRUPTED_STATUSES: readonly MissionStatus[] = [
  MissionStatus.Planning,
  MissionStatus.Running,
];

/** One planned recovery action (pure data — applying it is a separate step). */
export interface RecoveryItem {
  missionId: string;
  fromStatus: MissionStatus;
  toStatus: MissionStatus;
  reason: string;
}

/** The set of recovery actions decided for a boot. */
export interface RecoveryPlan {
  items: RecoveryItem[];
}

/**
 * Pure: given the missions loaded from disk at boot, decide which were
 * interrupted by the restart and should be parked in `paused`. Terminal and
 * already-parked (`paused`/`waiting_approval`) missions are skipped. Does NOT
 * mutate its input.
 */
export function planBootRecovery(missions: readonly Mission[]): RecoveryPlan {
  const items: RecoveryItem[] = [];
  for (const m of missions) {
    if (isTerminalStatus(m.status)) continue;
    if (!INTERRUPTED_STATUSES.includes(m.status)) continue; // paused / waiting_approval
    items.push({
      missionId: m.id,
      fromStatus: m.status,
      toStatus: MissionStatus.Paused,
      reason: 'process_restart',
    });
  }
  return { items };
}

/**
 * Apply boot recovery through the manager's existing public API: record an
 * audit event, then transition each interrupted mission to `paused`. Returns
 * the items applied.
 *
 * Idempotent across restarts: once a mission is `paused` it is no longer in
 * {@link INTERRUPTED_STATUSES}, so a second boot is a no-op.
 */
export async function applyBootRecovery(manager: MissionManager): Promise<RecoveryItem[]> {
  const plan = planBootRecovery(manager.listMissions());
  for (const item of plan.items) {
    await manager.recordEvent(item.missionId, {
      type: 'boot-recovery',
      message: `Mission was '${item.fromStatus}' at startup; paused for safe resume after a restart.`,
      data: { fromStatus: item.fromStatus, reason: item.reason },
    });
    await manager.updateStatus(item.missionId, item.toStatus);
  }
  return plan.items;
}
