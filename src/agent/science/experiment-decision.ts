/**
 * AI-Scientist-lite — Phase 1: the empirical keep/reject decision.
 *
 * REUSES the DGM aggregation (`computeFitness`) and regression logic
 * (`detectRegressions`) from `variant-fitness.ts`, but compares against an
 * EXPERIMENT baseline (the parent variant's fitness, or a supplied baseline) —
 * NEVER `main` and NEVER the repo's own tests. Verdict: keep iff the variant
 * beats its baseline with no regression (rollback = simply not kept — the
 * variant stays archived, never published).
 *
 * @module agent/science/experiment-decision
 */

import {
  computeFitness,
  detectRegressions,
  type FitnessComponent,
  type FitnessContext,
  type FitnessReport,
} from '../self-improvement/evolution/variant-fitness.js';

export interface KeepDecision {
  keep: boolean;
  reason: string;
  /** current.score − baseline.score (baseline 0 when absent). */
  delta: number;
  /** Component names that regressed vs the baseline. */
  regressions: string[];
}

export interface DecideKeepOptions {
  /** Minimum improvement over the baseline to keep (default 1e-9). */
  minDelta?: number;
  /** Require every component to pass (default true). */
  requirePassedAll?: boolean;
  /** Reject if any component regressed vs the baseline (default true). */
  rejectRegressions?: boolean;
}

/**
 * Score an experiment: run the (single) experiment fitness component through the
 * SAME `computeFitness` aggregation the evolution loop uses, flagging
 * regressions vs an optional experiment baseline. Thin, reuse-only wrapper.
 */
export async function scoreExperiment(
  ctx: FitnessContext,
  components: FitnessComponent[],
  baseline?: FitnessReport,
): Promise<FitnessReport> {
  return computeFitness(ctx, components, baseline);
}

/**
 * Decide whether to KEEP a scored variant vs its baseline.
 *
 * - With a baseline: keep iff `delta > minDelta`, no regression, and (by
 *   default) every component passed. Reject otherwise → rollback (not kept).
 * - Without a baseline (a root variant): keep iff it produced a real signal
 *   (`score > 0` and, by default, passedAll). This is the "first stepping stone"
 *   case — there is nothing to beat yet.
 *
 * Pure + deterministic. `detectRegressions` is reused so the regression contract
 * is identical to the evolution loop.
 */
export function decideKeep(
  current: FitnessReport,
  baseline?: FitnessReport,
  opts: DecideKeepOptions = {},
): KeepDecision {
  const minDelta = opts.minDelta ?? 1e-9;
  const requirePassedAll = opts.requirePassedAll !== false;
  const rejectRegressions = opts.rejectRegressions !== false;

  // Recompute regressions from the primitive so the verdict never trusts a
  // possibly-stale `current.regressions` field.
  const regressions = baseline ? detectRegressions(baseline, current.components) : [];
  const baselineScore = baseline?.score ?? 0;
  const delta = current.score - baselineScore;

  if (requirePassedAll && !current.passedAll) {
    return { keep: false, reason: 'un composant n\'a pas passé (passedAll=false)', delta, regressions };
  }
  if (rejectRegressions && regressions.length > 0) {
    return { keep: false, reason: `régression vs baseline: ${regressions.join(', ')}`, delta, regressions };
  }

  if (!baseline) {
    if (current.score > 0) {
      return { keep: true, reason: `premier variant (score ${current.score.toFixed(3)}, pas de baseline)`, delta, regressions };
    }
    return { keep: false, reason: 'aucun signal mesuré (score 0)', delta, regressions };
  }

  if (delta > minDelta) {
    return { keep: true, reason: `amélioration de ${delta.toFixed(3)} vs baseline`, delta, regressions };
  }
  return {
    keep: false,
    reason: delta < 0 ? `régression de ${Math.abs(delta).toFixed(3)} vs baseline` : 'aucune amélioration vs baseline',
    delta,
    regressions,
  };
}
