/**
 * AI-Scientist-lite — Phase 1: the experiment variant store.
 *
 * An append-only record of SCORED experiment variants, calqued on
 * `CodeVariantStore`/`EvolutionaryArchive` but DECOUPLED from the repo: a record
 * carries the experiment's hypothesis + code + execution summary + measured
 * metric + fitness + lineage (`parentId`), NOT a git branch/sha of Code Buddy.
 *
 * It records and reads back; it NEVER "publishes" a variant. `kept` flips to true
 * ONLY after the human keep-gate approves (Phase 1 §4) — a rejected/ungated
 * variant stays archived (auditable) but is never marked kept. Timestamps are
 * INJECTED by the caller (no `Date.now()` here). never-throws.
 *
 * @module agent/science/experiment-variant-store
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { logger } from '../../utils/logger.js';
import type { ExecuteCodeLanguage } from '../../tools/execute-code-runner.js';

/** A compact, faithful summary of an execution (not the full multi-KB blob). */
export interface ExperimentExecutionSummary {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  runId: string;
  /** The experiment folder the run happened in (the sandbox run dir). */
  runDir: string;
  durationMs: number;
}

/** The measured metric a variant was scored on. */
export interface ExperimentVariantMetric {
  name: string;
  /** Raw measured value (null when the metric could not be parsed). */
  value: number | null;
  /** Normalised metric score in [0,1]. */
  score: number;
  detail: string;
}

export interface ExperimentVariantRecord {
  id: string;
  /** The hypothesis this variant tested. */
  hypothesis: string;
  /** The experiment program that was run. */
  code: string;
  language: ExecuteCodeLanguage;
  /** Compact execution outcome (the experiment folder + exit status). */
  executionResult: ExperimentExecutionSummary;
  /** The measured metric the variant was scored on. */
  metric: ExperimentVariantMetric;
  /** Aggregate fitness in [0,1] (from `computeFitness`). */
  score: number;
  passedAll: boolean;
  /** Component names that regressed vs the experiment baseline (empty = none). */
  regressions: string[];
  /** Genealogy: the parent variant this one was derived from (absent = root). */
  parentId?: string;
  /** True ONLY after the human keep-gate approved. Never set implicitly. */
  kept: boolean;
  /** Injected ISO-8601 timestamp (the store never calls Date.now()). */
  createdAt: string;
  detail?: string;
}

export interface ExperimentBestOptions {
  /** Only consider variants strictly above this score (e.g. a baseline). */
  baselineScore?: number;
  /** Require passedAll (default true). */
  requirePassedAll?: boolean;
  /** Reject variants with any regression (default true). */
  rejectRegressions?: boolean;
  /** Require the human keep-gate to have approved (default false). */
  requireKept?: boolean;
}

interface StoreFile {
  schemaVersion: number;
  variants: ExperimentVariantRecord[];
}

const SCHEMA_VERSION = 1;

function defaultStorePath(): string {
  return join(process.cwd(), '.codebuddy', 'science', 'experiment-variants.json');
}

/**
 * Append-only store for scored experiment variants. Mirrors `CodeVariantStore`:
 * `record()` appends, `list()`/`get()` read back, `best()` selects. never-throws.
 */
export class ExperimentVariantStore {
  private readonly path: string;

  constructor(path?: string) {
    this.path = path ?? defaultStorePath();
  }

  getPath(): string {
    return this.path;
  }

  list(): ExperimentVariantRecord[] {
    if (!existsSync(this.path)) return [];
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<StoreFile>;
      return Array.isArray(data?.variants) ? (data.variants as ExperimentVariantRecord[]) : [];
    } catch (err) {
      logger.warn(`[science] experiment variant store unreadable: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  get(id: string): ExperimentVariantRecord | null {
    return this.list().find((v) => v.id === id) ?? null;
  }

  /** Append a variant record (best-effort, never throws). */
  record(rec: ExperimentVariantRecord): void {
    try {
      const variants = this.list();
      variants.push(rec);
      mkdirSync(dirname(this.path), { recursive: true });
      const file: StoreFile = { schemaVersion: SCHEMA_VERSION, variants };
      writeFileSync(this.path, JSON.stringify(file, null, 2));
    } catch (err) {
      logger.warn(`[science] experiment variant store write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * The winner: highest-scoring variant that passed everything, has no
   * regression, and (if given) strictly beats the baseline score. Ties broken by
   * most recent. null if none qualify.
   */
  best(opts: ExperimentBestOptions = {}): ExperimentVariantRecord | null {
    const requirePassedAll = opts.requirePassedAll !== false;
    const rejectRegressions = opts.rejectRegressions !== false;
    const eligible = this.list().filter((v) => {
      if (requirePassedAll && !v.passedAll) return false;
      if (rejectRegressions && v.regressions.length > 0) return false;
      if (opts.requireKept && !v.kept) return false;
      if (opts.baselineScore !== undefined && !(v.score > opts.baselineScore)) return false;
      return true;
    });
    if (eligible.length === 0) return null;
    return eligible.reduce((best, v) => {
      if (v.score > best.score) return v;
      if (v.score === best.score && v.createdAt > best.createdAt) return v;
      return best;
    });
  }
}
