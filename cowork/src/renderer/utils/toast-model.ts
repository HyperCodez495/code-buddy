/**
 * Pure helpers for mission completion toasts.
 *
 * @module renderer/utils/toast-model
 */

export interface MissionSummary {
  title: string;
  durationMs: number;
  deliverableCount: number;
  detail?: string;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function formatSummary(summary: MissionSummary): string {
  return `${summary.title} · ${formatDuration(summary.durationMs)} · ${summary.deliverableCount} livrable(s)`;
}
