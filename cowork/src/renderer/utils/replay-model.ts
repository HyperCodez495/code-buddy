/**
 * Pure helpers for mission replay timelines.
 *
 * @module renderer/utils/replay-model
 */

export interface RunEvent {
  id: string;
  atMs: number;
  type: 'message' | 'tool' | 'checkpoint' | 'error' | 'done';
  label: string;
  detail?: string;
}

export interface TimelineMark {
  id: string;
  atMs: number;
  type: RunEvent['type'];
  label: string;
}

export function buildTimeline(events: RunEvent[]): TimelineMark[] {
  return [...events]
    .sort((a, b) => a.atMs - b.atMs)
    .map((event) => ({ id: event.id, atMs: Math.max(0, event.atMs), type: event.type, label: event.label }));
}

export function eventAt(events: RunEvent[], ms: number): RunEvent | null {
  const ordered = [...events].sort((a, b) => a.atMs - b.atMs);
  let current: RunEvent | null = null;
  for (const event of ordered) {
    if (event.atMs > ms) break;
    current = event;
  }
  return current;
}
