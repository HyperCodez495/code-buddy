/**
 * Pure, framework-agnostic render helpers for progress + checklist display.
 *
 * Everything here is a pure function: given a snapshot (and an animation frame
 * counter for spinners) it returns plain strings. The Ink terminal component and
 * the Cowork React component both build on these so the two UIs stay visually in
 * sync, and so the logic is trivially unit-testable. Colour/markup is applied by
 * the renderers on top of these strings.
 */
import type { ProgressSnapshot } from './types.js';

/** Animated star glyphs (matches the `✽`-style spinner). */
export const STAR_FRAMES = ['✶', '✸', '✹', '✺', '✻', '✼'] as const;

/** Block glyphs for the progress bar. */
export const BAR_FILLED = '▰';
export const BAR_EMPTY = '▱';

/** Checklist glyphs. */
export const TODO_GLYPH = {
  pending: '◻',
  in_progress: '◻',
  completed: '✔',
  error: '✗',
} as const;

export type TodoStatus = keyof typeof TODO_GLYPH;

export interface TodoEntry {
  label: string;
  status: TodoStatus;
}

/** The current spinner glyph for a given frame counter. */
export function spinnerFrame(frame: number): string {
  const idx = ((frame % STAR_FRAMES.length) + STAR_FRAMES.length) % STAR_FRAMES.length;
  return STAR_FRAMES[idx] as string;
}

/** `41s`, `7m 5s`, `1h02m`. */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (totalMin < 60) return `${totalMin}m ${sec}s`;
  const hr = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return `${hr}h${String(min).padStart(2, '0')}m`;
}

/** Determinate / time-anchored bar: filled proportion of `width` cells. */
export function renderBar(percent: number, width: number): string {
  const w = Math.max(1, Math.floor(width));
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * w);
  return BAR_FILLED.repeat(filled) + BAR_EMPTY.repeat(w - filled);
}

/**
 * Indeterminate "knight-rider" bar: a small lit window bounces across `width`
 * cells, driven by the animation `frame` so callers don't need to track phase.
 */
export function renderIndeterminateBar(frame: number, width: number, windowSize = 4): string {
  const w = Math.max(1, Math.floor(width));
  const win = Math.max(1, Math.min(windowSize, w));
  const span = Math.max(1, w - win);
  const period = span * 2; // out-and-back
  const phase = ((frame % period) + period) % period;
  const start = phase <= span ? phase : period - phase; // ping-pong
  const cells: string[] = [];
  for (let i = 0; i < w; i++) cells.push(i >= start && i < start + win ? BAR_FILLED : BAR_EMPTY);
  return cells.join('');
}

/**
 * Compose the progress block into plain lines (no colour). Returns 1–3 lines:
 *  1. `✽ <label> (<elapsed>)[ — <message>]`
 *  2. `<bar>[ NN%]`            (omitted entirely for pure indeterminate w/o motion? no — bar always shown)
 *  3. `  ⎿  Next: <hint>`      (omitted when no hint)
 */
export function renderProgressLines(
  snapshot: ProgressSnapshot,
  opts: { width?: number; frame?: number } = {},
): string[] {
  const width = opts.width ?? 28;
  const frame = opts.frame ?? 0;
  const lines: string[] = [];

  const elapsed = formatElapsed(snapshot.elapsedMs);
  const head =
    snapshot.status === 'running'
      ? `${spinnerFrame(frame)} ${snapshot.label} (${elapsed})`
      : `${snapshot.status === 'complete' ? '✔' : '✗'} ${snapshot.message ?? snapshot.label}`;
  lines.push(head);

  if (snapshot.status === 'running') {
    if (snapshot.percent === null) {
      lines.push(`  ${renderIndeterminateBar(frame, width)}`);
    } else {
      lines.push(`  ${renderBar(snapshot.percent, width)} ${Math.round(snapshot.percent)}%`);
    }
    if (snapshot.nextHint && snapshot.nextHint.trim()) {
      lines.push(`  ⎿  Next: ${snapshot.nextHint.trim()}`);
    }
  }

  return lines;
}

/**
 * Render a checklist (the live todo list). Completed items are summarised once
 * the list is long: the most recent `maxVisible` entries are shown (prioritising
 * pending/in-progress), with a `… +N completed` overflow footer.
 */
export function renderTodoLines(
  todos: readonly TodoEntry[],
  opts: { maxVisible?: number; indent?: string } = {},
): string[] {
  const maxVisible = Math.max(1, opts.maxVisible ?? 6);
  const indent = opts.indent ?? '  ';
  if (todos.length === 0) return [];

  const active = todos.filter((t) => t.status === 'pending' || t.status === 'in_progress');
  const done = todos.filter((t) => t.status === 'completed' || t.status === 'error');

  // Always show active items; fill the rest of the budget with completed ones.
  const visibleDoneCount = Math.max(0, maxVisible - active.length);
  const visibleDone = done.slice(0, visibleDoneCount);
  const hiddenDone = done.length - visibleDone.length;

  const lines: string[] = [];
  for (const t of [...active, ...visibleDone]) {
    lines.push(`${indent}${TODO_GLYPH[t.status]} ${t.label}`);
  }
  if (hiddenDone > 0) {
    lines.push(`${indent} … +${hiddenDone} completed`);
  }
  return lines;
}
