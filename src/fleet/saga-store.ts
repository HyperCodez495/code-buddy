/**
 * Fleet — Saga store (Fleet P4).
 *
 * A "saga" is a multi-step LLM dispatch composed of one or more
 * lanes (primary, fallback, or N parallel) plus an optional
 * aggregator that synthesises the parallel results into a single
 * answer. Sagas are persisted to disk so a process crash mid-flight
 * doesn't lose state — the next boot scans the directory and
 * resumes pending steps.
 *
 * Storage layout:
 *
 *   ~/.codebuddy/sagas/
 *     <sagaId>.json    — one file per saga
 *     <sagaId>.lock    — PID-based lock (reuses session-lock.ts)
 *
 * The store is intentionally minimal — the orchestration loop
 * (which decides when a step is `pending` vs `running` vs `done`)
 * lives in the saga executor (separate module).
 *
 * @module fleet/saga-store
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { withSessionLock } from '../persistence/session-lock.js';
import { logger } from '../utils/logger.js';
import type { DispatchPlan } from './task-router.js';

export type SagaStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export type SagaStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** A single dispatched step within a saga. */
export interface SagaStep {
  peerId: string;
  model: string;
  /** Lane this step belongs to. Used to route results to the aggregator. */
  lane: 'primary' | 'fallback' | 'parallel';
  /** RunId returned by `peer.dispatch` on the target peer. */
  runId?: string;
  status: SagaStepStatus;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
}

/** Persisted saga record. */
export interface SagaRecord {
  /** Stable id `saga_<ts>_<rand>` minted at creation. */
  id: string;
  /** Original goal text (used by the aggregator + UI). */
  goal: string;
  /** Plan from the TaskRouter (frozen at creation, not re-routed). */
  plan: DispatchPlan;
  /** Steps tracked per lane — populated as dispatch fires. */
  steps: SagaStep[];
  /** Optional aggregator prompt template (defaults if omitted). */
  aggregatorPrompt?: string;
  /** Final synthesised answer once all parallel steps complete. */
  finalResult?: string;
  /** Top-level status — derived from step statuses + aggregator. */
  status: SagaStatus;
  /** Free-form metadata (privacyTag, costTag, etc.). */
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

/** Optional config for the SagaStore — testable. */
export interface SagaStoreConfig {
  /** Override the default `~/.codebuddy/sagas/` directory. */
  storeDir?: string;
}

/**
 * Disk-backed saga registry. One process per machine talks to the
 * same directory; the lockfile prevents concurrent writes from
 * stomping each other.
 */
export class SagaStore {
  private readonly dir: string;

  constructor(config: SagaStoreConfig = {}) {
    this.dir = config.storeDir ?? this.defaultDir();
    this.ensureDir();
  }

  /** Mint a new saga id. Format mirrors session-store for consistency. */
  static nextSagaId(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `saga_${ts}_${rand}`;
  }

  /** Create + persist a fresh saga from a router plan. */
  async create(input: {
    goal: string;
    plan: DispatchPlan;
    aggregatorPrompt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<SagaRecord> {
    const now = Date.now();
    const record: SagaRecord = {
      id: SagaStore.nextSagaId(),
      goal: input.goal,
      plan: input.plan,
      steps: this.buildInitialSteps(input.plan),
      aggregatorPrompt: input.aggregatorPrompt,
      status: 'pending',
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    await this.write(record);
    return record;
  }

  /** Read a saga by id. Returns null if not found. */
  async load(sagaId: string): Promise<SagaRecord | null> {
    const file = this.fileFor(sagaId);
    if (!fs.existsSync(file)) return null;
    try {
      const raw = await fs.promises.readFile(file, 'utf-8');
      return JSON.parse(raw) as SagaRecord;
    } catch (err) {
      logger.warn?.('[saga-store] failed to read saga', {
        sagaId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Atomically mutate a saga via a callback. Caller receives the
   * current record, returns the new state. The store handles
   * locking + write + bumping `updatedAt`.
   */
  async update(
    sagaId: string,
    mutator: (current: SagaRecord) => SagaRecord | Promise<SagaRecord>,
  ): Promise<SagaRecord | null> {
    const file = this.fileFor(sagaId);
    let result: SagaRecord | null = null;
    await withSessionLock(file, async () => {
      const current = await this.load(sagaId);
      if (!current) return;
      const next = await mutator(current);
      next.updatedAt = Date.now();
      // Derive top-level status from step statuses if mutator didn't.
      next.status = next.status ?? deriveSagaStatus(next);
      if (
        next.status === 'completed' ||
        next.status === 'failed' ||
        next.status === 'cancelled'
      ) {
        next.completedAt = next.completedAt ?? Date.now();
      }
      await this.writeUnlocked(next);
      result = next;
    });
    return result;
  }

  /** Mark a step as completed and store the result. */
  async completeStep(
    sagaId: string,
    laneIndex: number,
    result: string,
  ): Promise<SagaRecord | null> {
    return this.update(sagaId, (saga) => {
      const step = saga.steps[laneIndex];
      if (!step) return saga;
      step.status = 'completed';
      step.result = result;
      step.completedAt = Date.now();
      saga.status = deriveSagaStatus(saga);
      return saga;
    });
  }

  /** Mark a step as failed. */
  async failStep(
    sagaId: string,
    laneIndex: number,
    error: string,
  ): Promise<SagaRecord | null> {
    return this.update(sagaId, (saga) => {
      const step = saga.steps[laneIndex];
      if (!step) return saga;
      step.status = 'failed';
      step.error = error;
      step.completedAt = Date.now();
      saga.status = deriveSagaStatus(saga);
      return saga;
    });
  }

  /** Set the aggregator output. Marks the saga `completed`. */
  async finalise(
    sagaId: string,
    finalResult: string,
  ): Promise<SagaRecord | null> {
    return this.update(sagaId, (saga) => {
      saga.finalResult = finalResult;
      saga.status = 'completed';
      saga.completedAt = Date.now();
      return saga;
    });
  }

  /** List all saga ids on disk, sorted by updatedAt desc. */
  async list(): Promise<SagaRecord[]> {
    const files = await fs.promises.readdir(this.dir);
    const records: SagaRecord[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      const r = await this.load(id);
      if (r) records.push(r);
    }
    records.sort((a, b) => b.updatedAt - a.updatedAt);
    return records;
  }

  /**
   * Find sagas that need resuming after a process restart. A saga
   * "needs resume" when it has at least one step in `pending` or
   * `running` and is not itself `completed`/`failed`/`cancelled`.
   */
  async findResumable(): Promise<SagaRecord[]> {
    const all = await this.list();
    return all.filter((s) => {
      if (s.status === 'completed' || s.status === 'failed' || s.status === 'cancelled') {
        return false;
      }
      return s.steps.some(
        (step) => step.status === 'pending' || step.status === 'running',
      );
    });
  }

  /** Delete a saga (and its lockfile). */
  async delete(sagaId: string): Promise<boolean> {
    const file = this.fileFor(sagaId);
    if (!fs.existsSync(file)) return false;
    await fs.promises.unlink(file);
    const lock = file + '.lock';
    if (fs.existsSync(lock)) {
      try {
        await fs.promises.unlink(lock);
      } catch {
        /* lock might be held by another process */
      }
    }
    return true;
  }

  // ─────────── Internals ───────────

  private defaultDir(): string {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    return path.join(home, '.codebuddy', 'sagas');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  private fileFor(sagaId: string): string {
    return path.join(this.dir, `${sagaId}.json`);
  }

  private async write(record: SagaRecord): Promise<void> {
    const file = this.fileFor(record.id);
    await withSessionLock(file, async () => {
      await this.writeUnlocked(record);
    });
  }

  private async writeUnlocked(record: SagaRecord): Promise<void> {
    const file = this.fileFor(record.id);
    const tmp = `${file}.tmp.${process.pid}`;
    await fs.promises.writeFile(tmp, JSON.stringify(record, null, 2));
    await fs.promises.rename(tmp, file);
  }

  private buildInitialSteps(plan: DispatchPlan): SagaStep[] {
    const steps: SagaStep[] = [];
    if (plan.parallel && plan.parallel.length > 0) {
      // Pure parallel dispatch — each lane is independent.
      for (const lane of plan.parallel) {
        steps.push({
          peerId: lane.peerId,
          model: lane.model,
          lane: 'parallel',
          status: 'pending',
        });
      }
    } else {
      steps.push({
        peerId: plan.primary.peerId,
        model: plan.primary.model,
        lane: 'primary',
        status: 'pending',
      });
      if (plan.fallback) {
        steps.push({
          peerId: plan.fallback.peerId,
          model: plan.fallback.model,
          lane: 'fallback',
          status: 'pending',
        });
      }
    }
    return steps;
  }
}

/**
 * Derive the top-level saga status from its steps. Pure function
 * exposed for tests. Non-trivial because a fallback step is only
 * meaningful when the primary failed — a pending fallback shouldn't
 * keep a saga in `pending` once the primary succeeds.
 */
export function deriveSagaStatus(saga: SagaRecord): SagaStatus {
  if (saga.steps.length === 0) return 'pending';

  // Parallel-only sagas: at-least-one-success == saga success once
  // every step is in a terminal state.
  const isParallelSaga = saga.steps.every((s) => s.lane === 'parallel');
  if (isParallelSaga) {
    if (saga.steps.some((s) => s.status === 'running')) return 'running';
    if (saga.steps.some((s) => s.status === 'pending')) return 'pending';
    const completed = saga.steps.filter((s) => s.status === 'completed').length;
    if (completed > 0) return 'completed';
    return 'failed';
  }

  // Sequential saga (primary + optional fallback).
  const primary = saga.steps.find((s) => s.lane === 'primary');
  const fallback = saga.steps.find((s) => s.lane === 'fallback');

  // Primary success short-circuits regardless of fallback state.
  if (primary?.status === 'completed') return 'completed';
  if (primary?.status === 'running' || fallback?.status === 'running') {
    return 'running';
  }
  if (primary?.status === 'pending') return 'pending';
  if (primary?.status === 'failed') {
    if (!fallback) return 'failed';
    if (fallback.status === 'completed') return 'completed';
    if (fallback.status === 'failed') return 'failed';
    // running was already handled above; remaining cases are
    // 'pending' | 'skipped' — both equivalent to "not started yet".
    return 'pending';
  }
  return 'pending';
}

let cachedStore: SagaStore | null = null;

/** Process-wide saga store. */
export function getSagaStore(): SagaStore {
  if (!cachedStore) cachedStore = new SagaStore();
  return cachedStore;
}

/** Test-only reset hook. */
export function resetSagaStore(): void {
  cachedStore = null;
}
