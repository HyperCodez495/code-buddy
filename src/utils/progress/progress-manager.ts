/**
 * Observable registry of progress tasks.
 *
 * Producers call {@link ProgressManager.start} and get a {@link ProgressTask}
 * handle they drive (update/complete/fail). Renderers subscribe to `start` /
 * `update` / `end` and draw whatever is active — they never need to know who the
 * producer is. The manager owns a single low-frequency tick that drives
 * elapsed-time / time-anchored percent animation and enforces the per-task
 * watchdog, so a lost completion signal can never wedge a renderer forever.
 */
import { EventEmitter } from 'node:events';
import { logger } from '../logger.js';
import { DurationEstimator } from './duration-estimator.js';
import { ProgressTask } from './progress-task.js';
import type { ProgressInit, ProgressSnapshot } from './types.js';

const TICK_MS = 120;
/** How long a completed task lingers (so the 100%/✔ frame is visible) before `end`. */
const DEFAULT_LINGER_MS = 700;

export interface ProgressManagerOptions {
  /** Per-kind seed durations (ms) for time-anchored estimation. */
  durationDefaults?: Record<string, number>;
  lingerMs?: number;
}

export class ProgressManager extends EventEmitter {
  private readonly tasks = new Map<string, ProgressTask>();
  private readonly estimator: DurationEstimator;
  private readonly lingerMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: ProgressManagerOptions = {}) {
    super();
    this.setMaxListeners(50);
    this.estimator = new DurationEstimator({
      defaults: { compaction: 30_000, ...opts.durationDefaults },
    });
    this.lingerMs = opts.lingerMs ?? DEFAULT_LINGER_MS;
  }

  /** Start a task. For `time-anchored` mode the estimate is filled in from history. */
  start(init: ProgressInit): ProgressTask {
    const resolved: ProgressInit = { ...init };
    if ((init.mode ?? 'indeterminate') === 'time-anchored' && init.estimateMs === undefined) {
      resolved.estimateMs = this.estimator.estimate(init.kind);
    }
    const task = new ProgressTask(resolved);
    task.onFinish = (t) => this.handleFinish(t);
    this.tasks.set(task.id, task);
    this.safeEmit('start', task.snapshot());
    this.safeEmit('update', task.snapshot());
    this.ensureTicking();
    return task;
  }

  /** Snapshots of all running tasks, oldest first. */
  getActive(): ProgressSnapshot[] {
    const now = Date.now();
    return [...this.tasks.values()]
      .filter((t) => t.status === 'running')
      .map((t) => t.snapshot(now));
  }

  /** The most recently started running task, or null — handy for single-line UIs. */
  getMostRecent(): ProgressSnapshot | null {
    const running = [...this.tasks.values()].filter((t) => t.status === 'running');
    const last = running[running.length - 1];
    return last ? last.snapshot() : null;
  }

  /** Invoked via the task's finish hook: record duration (on success), emit the terminal frame, then schedule removal. */
  private handleFinish(task: ProgressTask): void {
    if (task.status === 'complete') {
      this.estimator.record(task.kind, (task.endedAt ?? Date.now()) - task.startedAt);
    }
    this.safeEmit('update', task.snapshot());
    if (this.lingerMs <= 0) {
      this.remove(task);
      return;
    }
    const t = setTimeout(() => this.remove(task), this.lingerMs);
    if (typeof t.unref === 'function') t.unref();
  }

  private remove(task: ProgressTask): void {
    if (!this.tasks.has(task.id)) return;
    this.tasks.delete(task.id);
    this.safeEmit('end', task.snapshot());
    if (this.tasks.size === 0) this.stopTicking();
  }

  private ensureTicking(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  private stopTicking(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const now = Date.now();
    let running = 0;
    for (const task of this.tasks.values()) {
      if (task.status !== 'running') continue;
      if (task.isStale(now)) {
        logger.warn(`Progress task '${task.kind}' (${task.id}) exceeded watchdog; force-failing.`);
        task.fail('Timed out', now); // triggers handleFinish via the task's onFinish hook
        continue;
      }
      running += 1;
      this.safeEmit('update', task.snapshot(now));
    }
    if (running === 0 && this.tasks.size === 0) this.stopTicking();
  }

  private safeEmit(event: 'start' | 'update' | 'end', snapshot: ProgressSnapshot): void {
    try {
      this.emit(event, snapshot);
    } catch (err) {
      logger.warn(`Progress listener for '${event}' threw: ${String(err)}`);
    }
  }

  /** Test/teardown helper: drop all tasks and stop the tick. */
  reset(): void {
    this.tasks.clear();
    this.stopTicking();
    this.removeAllListeners();
  }
}

let singleton: ProgressManager | null = null;

export function getProgressManager(): ProgressManager {
  if (!singleton) singleton = new ProgressManager();
  return singleton;
}

/** Test-only: replace the singleton. */
export function __setProgressManagerForTests(mgr: ProgressManager | null): void {
  singleton = mgr;
}
