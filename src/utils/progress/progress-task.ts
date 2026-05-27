/**
 * A single progress task. Holds mutable state and computes a {@link ProgressSnapshot}
 * on demand. Percent/ETA derivation is mode-specific:
 *
 * - `determinate`   — percent = current/total; eta extrapolated from rate.
 * - `time-anchored` — percent = elapsed/estimate, capped at {@link TIME_ANCHORED_CAP}
 *                     while running so it never claims completion early; snaps to
 *                     100 on `complete`. eta = estimate − elapsed.
 * - `indeterminate` — percent = null, eta = null.
 *
 * The task itself owns no timers; the {@link ProgressManager} ticks it.
 */
import type { ProgressInit, ProgressMode, ProgressSnapshot, ProgressStatus } from './types.js';

/** Time-anchored bars stop here until the real completion signal arrives. */
export const TIME_ANCHORED_CAP = 95;

let counter = 0;
function nextId(kind: string): string {
  counter += 1;
  return `${kind}-${Date.now().toString(36)}-${counter}`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export class ProgressTask {
  readonly id: string;
  readonly kind: string;
  readonly mode: ProgressMode;
  readonly startedAt: number;
  readonly watchdogMs: number;

  label: string;
  status: ProgressStatus = 'running';
  current: number;
  total: number | undefined;
  estimateMs: number | undefined;
  nextHint: string | undefined;
  message: string | undefined;
  updatedAt: number;
  endedAt: number | undefined;

  /** Called exactly once when the task transitions to a terminal state. Set by the manager. */
  onFinish: ((task: ProgressTask) => void) | undefined;

  constructor(init: ProgressInit, now: number = Date.now()) {
    this.id = init.id ?? nextId(init.kind);
    this.kind = init.kind;
    this.label = init.label;
    this.mode = init.mode ?? 'indeterminate';
    this.startedAt = now;
    this.updatedAt = now;
    this.current = init.current ?? 0;
    this.total = init.total;
    this.estimateMs = init.estimateMs;
    this.nextHint = init.nextHint;
    this.watchdogMs = init.watchdogMs ?? 5 * 60_000;
  }

  /** Update mutable fields while running. No-op once terminal. */
  update(patch: Partial<Pick<ProgressTask, 'label' | 'current' | 'total' | 'nextHint' | 'estimateMs'>>, now: number = Date.now()): void {
    if (this.status !== 'running') return;
    if (patch.label !== undefined) this.label = patch.label;
    if (patch.current !== undefined) this.current = patch.current;
    if (patch.total !== undefined) this.total = patch.total;
    if (patch.nextHint !== undefined) this.nextHint = patch.nextHint;
    if (patch.estimateMs !== undefined) this.estimateMs = patch.estimateMs;
    this.updatedAt = now;
  }

  complete(message?: string, now: number = Date.now()): void {
    this.finish('complete', message, now);
  }

  fail(message?: string, now: number = Date.now()): void {
    this.finish('error', message, now);
  }

  cancel(message?: string, now: number = Date.now()): void {
    this.finish('canceled', message, now);
  }

  private finish(status: ProgressStatus, message: string | undefined, now: number): void {
    if (this.status !== 'running') return;
    this.status = status;
    if (message !== undefined) this.message = message;
    this.endedAt = now;
    this.updatedAt = now;
    this.onFinish?.(this);
  }

  get isTerminal(): boolean {
    return this.status !== 'running';
  }

  /** Whether the watchdog deadline has passed (manager uses this to force-fail). */
  isStale(now: number = Date.now()): boolean {
    return this.status === 'running' && now - this.startedAt > this.watchdogMs;
  }

  snapshot(now: number = Date.now()): ProgressSnapshot {
    const elapsedMs = Math.max(0, (this.endedAt ?? now) - this.startedAt);
    const { percent, etaMs } = this.derive(elapsedMs);
    return {
      id: this.id,
      kind: this.kind,
      label: this.label,
      mode: this.mode,
      status: this.status,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      ...(this.endedAt !== undefined ? { endedAt: this.endedAt } : {}),
      ...(this.current !== undefined ? { current: this.current } : {}),
      ...(this.total !== undefined ? { total: this.total } : {}),
      ...(this.estimateMs !== undefined ? { estimateMs: this.estimateMs } : {}),
      percent,
      elapsedMs,
      etaMs,
      ...(this.nextHint !== undefined ? { nextHint: this.nextHint } : {}),
      ...(this.message !== undefined ? { message: this.message } : {}),
    };
  }

  private derive(elapsedMs: number): { percent: number | null; etaMs: number | null } {
    if (this.status === 'complete') return { percent: 100, etaMs: 0 };
    if (this.status === 'error' || this.status === 'canceled') {
      // Freeze the last meaningful percent at the terminal point.
      return { percent: this.lastRunningPercent(elapsedMs), etaMs: 0 };
    }

    switch (this.mode) {
      case 'determinate': {
        if (this.total && this.total > 0) {
          const percent = clampPercent((this.current / this.total) * 100);
          const remaining = this.total - this.current;
          const rate = elapsedMs > 0 ? this.current / elapsedMs : 0; // items per ms
          const etaMs = rate > 0 ? Math.round(remaining / rate) : null;
          return { percent, etaMs };
        }
        return { percent: 0, etaMs: null };
      }
      case 'time-anchored': {
        const estimate = this.estimateMs && this.estimateMs > 0 ? this.estimateMs : 30_000;
        const raw = (elapsedMs / estimate) * 100;
        const percent = Math.min(TIME_ANCHORED_CAP, clampPercent(raw));
        return { percent, etaMs: Math.max(0, estimate - elapsedMs) };
      }
      case 'indeterminate':
      default:
        return { percent: null, etaMs: null };
    }
  }

  private lastRunningPercent(elapsedMs: number): number | null {
    if (this.mode === 'determinate') {
      return this.total && this.total > 0 ? clampPercent((this.current / this.total) * 100) : 0;
    }
    if (this.mode === 'time-anchored') {
      const estimate = this.estimateMs && this.estimateMs > 0 ? this.estimateMs : 30_000;
      return Math.min(TIME_ANCHORED_CAP, clampPercent((elapsedMs / estimate) * 100));
    }
    return null;
  }
}
