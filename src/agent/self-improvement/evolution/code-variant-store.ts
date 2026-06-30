/**
 * Code variant store (Phase B): an append-only record of EVALUATED candidate variants (git branch
 * + sha + fitness + regressions). Mirrors the LearningStore/EvolutionaryArchive pattern, but for
 * whole-agent CODE variants. It records and ranks; it NEVER merges or checks out — keep/merge is
 * human-gated (Phase E). `best()` is the "la version qui marche mieux" selector.
 *
 * @module agent/self-improvement/evolution/code-variant-store
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { logger } from '../../../utils/logger.js';

export interface VariantRecord {
  id: string;
  branch: string;
  sha: string;
  /** Aggregate fitness in [0,1]. */
  score: number;
  passedAll: boolean;
  /** Component names that regressed vs the baseline (empty = none). */
  regressions: string[];
  createdAt: string;
  detail?: string;
}

export interface BestOptions {
  /** Only consider variants strictly above this score (e.g. the baseline's score). */
  baselineScore?: number;
  /** Require passedAll (default true). */
  requirePassedAll?: boolean;
  /** Reject variants with any regression (default true). */
  rejectRegressions?: boolean;
}

function defaultStorePath(): string {
  return join(process.cwd(), '.codebuddy', 'self-improvement', 'evolution', 'variants.json');
}

export class CodeVariantStore {
  private readonly path: string;

  constructor(path?: string) {
    this.path = path ?? defaultStorePath();
  }

  getPath(): string {
    return this.path;
  }

  list(): VariantRecord[] {
    if (!existsSync(this.path)) return [];
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8'));
      return Array.isArray(data?.variants) ? (data.variants as VariantRecord[]) : [];
    } catch (err) {
      logger.warn(`[evolve] variant store unreadable: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /** Append a variant record (best-effort, never throws). */
  record(rec: VariantRecord): void {
    try {
      const variants = this.list();
      variants.push(rec);
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify({ schemaVersion: 1, variants }, null, 2));
    } catch (err) {
      logger.warn(`[evolve] variant store write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * The winner: highest-scoring variant that passed everything, has no regression, and (if given)
   * strictly beats the baseline score. Ties broken by most recent. null if none qualify.
   */
  best(opts: BestOptions = {}): VariantRecord | null {
    const requirePassedAll = opts.requirePassedAll !== false;
    const rejectRegressions = opts.rejectRegressions !== false;
    const eligible = this.list().filter((v) => {
      if (requirePassedAll && !v.passedAll) return false;
      if (rejectRegressions && v.regressions.length > 0) return false;
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
