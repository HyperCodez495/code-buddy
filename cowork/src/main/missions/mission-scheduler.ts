/**
 * Mission Orchestrator — pure DAG scheduler.
 *
 * Decides which pending sub-tasks are ready to run once their dependencies
 * are satisfied. It does not start agents, mutate mission state, set timers,
 * or touch Electron/IPC. The future MissionBridge can call this on each
 * heartbeat / scheduler tick, then dispatch the returned sub-tasks.
 *
 * @module cowork/main/missions/mission-scheduler
 */

import { MissionStatus, SubTaskStatus, isTerminalStatus, type Mission, type SubTask } from './mission-types.js';

export const DEFAULT_SCHEDULABLE_MISSION_STATUSES: readonly MissionStatus[] = [MissionStatus.Running];
export const DEFAULT_CANDIDATE_SUBTASK_STATUSES: readonly SubTaskStatus[] = [SubTaskStatus.Pending];
export const DEFAULT_SATISFIED_DEPENDENCY_STATUSES: readonly SubTaskStatus[] = [SubTaskStatus.Completed];

export interface ReadySubTasksOptions {
  /** Mission statuses allowed to emit ready sub-tasks. Defaults to `running`. */
  schedulableMissionStatuses?: readonly MissionStatus[];
  /** Sub-task statuses that may be scheduled. Defaults to `pending`. */
  candidateSubTaskStatuses?: readonly SubTaskStatus[];
  /** Dependency statuses considered satisfied. Defaults to `completed`. */
  satisfiedDependencyStatuses?: readonly SubTaskStatus[];
}

export interface SubTaskDependencyBlockers {
  /** Dependency ids that do not exist in the mission DAG. */
  missing: string[];
  /** Existing dependency ids whose status is not satisfied yet. */
  unsatisfied: Array<{ id: string; status: SubTaskStatus }>;
}

/** True when the mission is in a non-terminal status that may run sub-tasks. */
export function isMissionSchedulable(mission: Mission, options: ReadySubTasksOptions = {}): boolean {
  if (isTerminalStatus(mission.status)) return false;
  const statuses = new Set(options.schedulableMissionStatuses ?? DEFAULT_SCHEDULABLE_MISSION_STATUSES);
  return statuses.has(mission.status);
}

/**
 * Return pending sub-tasks whose dependency ids all exist and are satisfied.
 * The returned order is the mission's original sub-task order, so dispatch is
 * stable and explainable in the Mission Board.
 */
export function readySubTasks(mission: Mission, options: ReadySubTasksOptions = {}): SubTask[] {
  if (!isMissionSchedulable(mission, options)) return [];

  const candidates = new Set(options.candidateSubTaskStatuses ?? DEFAULT_CANDIDATE_SUBTASK_STATUSES);
  const dependenciesById = indexSubTasks(mission.subTasks);
  return mission.subTasks.filter((subTask) => {
    if (!candidates.has(subTask.status)) return false;
    const blockers = dependencyBlockers(subTask, dependenciesById, options);
    return blockers.missing.length === 0 && blockers.unsatisfied.length === 0;
  });
}

/**
 * Explain why a sub-task is not dependency-ready. This is intentionally pure
 * so the UI can show "waiting on A/B" without duplicating scheduler logic.
 */
export function dependencyBlockers(
  subTask: SubTask,
  dependenciesById: ReadonlyMap<string, SubTask>,
  options: Pick<ReadySubTasksOptions, 'satisfiedDependencyStatuses'> = {}
): SubTaskDependencyBlockers {
  const satisfiedStatuses = new Set(options.satisfiedDependencyStatuses ?? DEFAULT_SATISFIED_DEPENDENCY_STATUSES);
  const missing: string[] = [];
  const unsatisfied: Array<{ id: string; status: SubTaskStatus }> = [];

  for (const dependencyId of uniqueIds(subTask.dependsOn ?? [])) {
    const dependency = dependenciesById.get(dependencyId);
    if (!dependency) {
      missing.push(dependencyId);
      continue;
    }
    if (!satisfiedStatuses.has(dependency.status)) {
      unsatisfied.push({ id: dependency.id, status: dependency.status });
    }
  }

  return { missing, unsatisfied };
}

/** Build a lookup map for a mission's sub-task DAG. */
export function indexSubTasks(subTasks: readonly SubTask[]): Map<string, SubTask> {
  return new Map(subTasks.map((subTask) => [subTask.id, subTask]));
}

function uniqueIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids));
}
