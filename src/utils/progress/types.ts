/**
 * Progress library — shared types.
 *
 * A framework-agnostic model for "something is happening, here is how far along".
 * Producers report progress through {@link ProgressManager}; any number of
 * renderers (Ink terminal UI, Cowork React UI, plain logger) subscribe and draw
 * the same {@link ProgressSnapshot}. The model supports three modes so it can
 * represent essentially any long-running operation:
 *
 * - `determinate`   — a real `current` / `total` (downloads, file sweeps, batched work).
 * - `indeterminate` — work with no measurable progress (a single network/LLM call).
 * - `time-anchored` — no real signal, but we estimate % from elapsed time vs. a
 *                     rolling estimate of how long this *kind* of task usually takes.
 *                     The percentage is an honest time estimate, capped below 100%
 *                     until the task actually completes.
 */

export type ProgressMode = 'determinate' | 'indeterminate' | 'time-anchored';

export type ProgressStatus = 'running' | 'complete' | 'error' | 'canceled';

/** Options accepted when starting a new progress task. */
export interface ProgressInit {
  /** Stable id. Auto-generated when omitted. */
  id?: string;
  /**
   * A coarse category used to bucket duration history for `time-anchored` mode
   * (e.g. `'compaction'`, `'indexing'`, `'embedding'`). Tasks of the same kind
   * share a rolling duration estimate.
   */
  kind: string;
  /** Human label, e.g. `'Compacting conversation…'`. */
  label: string;
  /** Defaults to `'indeterminate'`. */
  mode?: ProgressMode;
  /** Required for `determinate` mode; the denominator. */
  total?: number;
  /** Starting value for `determinate` mode (default 0). */
  current?: number;
  /**
   * Explicit duration estimate (ms) for `time-anchored` mode. When omitted the
   * estimate comes from the {@link DurationEstimator} for this `kind`.
   */
  estimateMs?: number;
  /** Optional contextual hint rendered as the `⎿ Next:` line. Omitted when empty. */
  nextHint?: string;
  /**
   * Auto-fail the task if it has not completed after this many ms, so a lost
   * completion signal can never wedge the UI. Default 5 minutes.
   */
  watchdogMs?: number;
}

/** A point-in-time, render-ready view of a progress task. */
export interface ProgressSnapshot {
  id: string;
  kind: string;
  label: string;
  mode: ProgressMode;
  status: ProgressStatus;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  /** `determinate` mode. */
  current?: number;
  total?: number;
  /** `time-anchored` mode estimate actually used. */
  estimateMs?: number;
  /** Completed fraction in [0,100], or `null` when not measurable (pure indeterminate). */
  percent: number | null;
  /** Wall-clock time since start (ms). */
  elapsedMs: number;
  /** Best-effort remaining time (ms), or `null` when unknown. */
  etaMs: number | null;
  nextHint?: string;
  /** Completion / error summary, e.g. `'Compacted 84k → 12k tokens'`. */
  message?: string;
}

/** Event names emitted by {@link ProgressManager}. */
export interface ProgressEvents {
  /** A new task was started. */
  start: (snapshot: ProgressSnapshot) => void;
  /** A task changed (value, tick-driven elapsed/percent, or status). */
  update: (snapshot: ProgressSnapshot) => void;
  /** A task reached a terminal state (complete/error/canceled) and was removed. */
  end: (snapshot: ProgressSnapshot) => void;
}
