/**
 * Mission Orchestrator — pure DAG scheduler tests.
 *
 * No Electron / IPC / timers: these tests cover the scheduling decision that
 * a future MissionBridge will call before dispatching sub-tasks to agents.
 */

import { describe, expect, it } from 'vitest';
import { MissionStatus, SubTaskStatus, type Mission, type SubTask } from '../src/main/missions/mission-types';
import {
  dependencyBlockers,
  indexSubTasks,
  isMissionSchedulable,
  readySubTasks,
} from '../src/main/missions/mission-scheduler';

describe('Mission DAG scheduler', () => {
  it('selects pending sub-tasks with no dependencies or completed dependencies', () => {
    const mission = sampleMission([
      task('research', SubTaskStatus.Completed),
      task('write', SubTaskStatus.Pending, ['research']),
      task('review', SubTaskStatus.Pending, ['write']),
      task('smoke', SubTaskStatus.Pending),
    ]);

    expect(readySubTasks(mission).map((subTask) => subTask.id)).toEqual(['write', 'smoke']);
  });

  it('blocks missing, running, failed, and skipped dependencies by default', () => {
    const mission = sampleMission([
      task('running-dep', SubTaskStatus.Running),
      task('failed-dep', SubTaskStatus.Failed),
      task('skipped-dep', SubTaskStatus.Skipped),
      task('blocked-running', SubTaskStatus.Pending, ['running-dep']),
      task('blocked-failed', SubTaskStatus.Pending, ['failed-dep']),
      task('blocked-skipped', SubTaskStatus.Pending, ['skipped-dep']),
      task('blocked-missing', SubTaskStatus.Pending, ['missing-dep']),
      task('ready-root', SubTaskStatus.Pending),
    ]);

    expect(readySubTasks(mission).map((subTask) => subTask.id)).toEqual(['ready-root']);
  });

  it('ignores sub-tasks that are already running, completed, failed, or skipped', () => {
    const mission = sampleMission([
      task('pending', SubTaskStatus.Pending),
      task('running', SubTaskStatus.Running),
      task('completed', SubTaskStatus.Completed),
      task('failed', SubTaskStatus.Failed),
      task('skipped', SubTaskStatus.Skipped),
    ]);

    expect(readySubTasks(mission).map((subTask) => subTask.id)).toEqual(['pending']);
  });

  it('does not emit ready work for paused, waiting, planning, or terminal missions', () => {
    for (const status of [
      MissionStatus.Planning,
      MissionStatus.WaitingApproval,
      MissionStatus.Paused,
      MissionStatus.Completed,
      MissionStatus.Failed,
      MissionStatus.Cancelled,
    ]) {
      expect(readySubTasks(sampleMission([task('root', SubTaskStatus.Pending)], status))).toEqual([]);
    }
    expect(isMissionSchedulable(sampleMission([], MissionStatus.Running))).toBe(true);
  });

  it('explains blockers without mutating the sub-task DAG', () => {
    const mission = sampleMission([
      task('done', SubTaskStatus.Completed),
      task('busy', SubTaskStatus.Running),
      task('target', SubTaskStatus.Pending, ['done', 'busy', 'missing', 'busy']),
    ]);
    const before = JSON.stringify(mission.subTasks);

    const blockers = dependencyBlockers(mission.subTasks[2]!, indexSubTasks(mission.subTasks));

    expect(blockers.missing).toEqual(['missing']);
    expect(blockers.unsatisfied).toEqual([{ id: 'busy', status: SubTaskStatus.Running }]);
    expect(JSON.stringify(mission.subTasks)).toBe(before);
  });

  it('can treat skipped dependencies as satisfied when a future bridge opts in', () => {
    const mission = sampleMission([
      task('optional', SubTaskStatus.Skipped),
      task('downstream', SubTaskStatus.Pending, ['optional']),
    ]);

    expect(readySubTasks(mission)).toEqual([]);
    expect(
      readySubTasks(mission, {
        satisfiedDependencyStatuses: [SubTaskStatus.Completed, SubTaskStatus.Skipped],
      }).map((subTask) => subTask.id)
    ).toEqual(['downstream']);
  });
});

function task(id: string, status: SubTaskStatus, dependsOn?: string[]): SubTask {
  return {
    id,
    title: id,
    status,
    progress: status === SubTaskStatus.Completed ? 100 : 0,
    ...(dependsOn ? { dependsOn } : {}),
  };
}

function sampleMission(subTasks: SubTask[], status: MissionStatus = MissionStatus.Running): Mission {
  const ts = '2026-06-07T12:00:00.000Z';
  return {
    id: 'mission-1',
    title: 'Mission',
    description: '',
    status,
    subTasks,
    progress: 0,
    createdAt: ts,
    updatedAt: ts,
    events: [],
    costUsd: 0,
    tokens: 0,
  };
}
