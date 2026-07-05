/**
 * Pure mission model helpers for Cowork mission surfaces.
 *
 * @module renderer/utils/mission-model
 */

export type MissionStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed';

export interface Mission {
  id: string;
  title: string;
  status: MissionStatus;
  progress: number;
  model: string;
  durationMs: number;
  detail?: string;
}

export interface MissionSummaryCounts {
  running: number;
  queued: number;
  done: number;
  failed: number;
}

export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

export function summarizeMissions(missions: Mission[]): MissionSummaryCounts {
  return missions.reduce<MissionSummaryCounts>(
    (summary, mission) => {
      if (mission.status === 'running') summary.running += 1;
      if (mission.status === 'queued' || mission.status === 'paused') summary.queued += 1;
      if (mission.status === 'done') summary.done += 1;
      if (mission.status === 'failed') summary.failed += 1;
      return summary;
    },
    { running: 0, queued: 0, done: 0, failed: 0 }
  );
}

export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (totalMinutes > 0) return `${totalMinutes}m ${seconds}s`;
  return `${seconds}s`;
}
