/**
 * Pure worker status helpers for Claw-style AI employee dashboards.
 *
 * @module renderer/utils/worker-status
 */

export interface WorkerStatus {
  online: boolean;
  uptimeSec: number;
  activeMissions: number;
  queuedMissions: number;
  processedToday: number;
  capacity: number;
}

export function healthLabel(status: WorkerStatus): 'ok' | 'busy' | 'down' {
  if (!status.online) return 'down';
  if (status.capacity > 0 && status.activeMissions + status.queuedMissions >= status.capacity) return 'busy';
  return 'ok';
}

export function formatUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0m';
  const minutes = Math.floor(sec / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
