/**
 * Cost-aware UCB model bandit (ShinkaEvolve-lite, Phase 0).
 *
 * Sakana's ShinkaEvolve makes an evolutionary loop *sample-efficient* by treating "which LLM should
 * author the next mutation?" as a multi-armed bandit instead of a fixed model. This module is the
 * bandit's decision rule: a **pure** function that, given a catalog of candidate LLMs and the
 * historical `ModelScoreboard`, returns the model id to try next.
 *
 * The rule is classic UCB1 with a cost penalty:
 *
 *     value(m) = reward(m) + c · √( ln(N) / n(m) )
 *     reward(m) = quality(m) − cost_aware_coef · normalizedCost(m)
 *
 * where
 *   - `quality(m)` = `scoreboard.smoothedWinRate(taskType, m)` ∈ (0,1) — the exploitation term (the
 *     scoreboard's Laplace-smoothed win rate; 0.5 for an unseen model);
 *   - `normalizedCost(m)` = `costInputUsdPerMtok(m) / maxCost` ∈ [0,1] — 0 when every candidate is
 *     $0 (local / flat-fee), so the cost term is a no-op when nothing costs money;
 *   - `n(m)` = `scoreboard.runCount(taskType, m)` and `N` = Σ n over the candidates;
 *   - a candidate with `n(m) === 0` is NEVER-tried → it gets an exploration priority that dominates
 *     any finite value (classic UCB "try each arm once first"), cheaper unseen arms first.
 *
 * This module does NOT own the scoreboard, the catalog, or the persistence — it only READS the stats
 * it is handed (the `ModelScoreboard` singleton records + persists them elsewhere). It is pure and
 * injectable (scoreboard + candidates passed as arguments) so it can be unit-tested without a network
 * or a singleton, and reused later by the AI-Scientist. It NEVER throws: any failure, an empty
 * catalog, or an empty scoreboard falls back to the first candidate (or `opts.fallbackModel`).
 *
 * @module agent/self-improvement/evolution/model-bandit
 */

import type { LlmCandidate } from '../../../fleet/model-selector.js';
import type { ModelScoreboard } from '../../../fleet/model-scoreboard.js';

/**
 * The slice of `ModelScoreboard` the bandit reads. Typing it structurally keeps `pickModelUCB` pure
 * and injectable: a real `ModelScoreboard` satisfies this, and a test can construct a real one over a
 * temp ledger (no mocks) — but the function never depends on the singleton or the concrete class.
 */
export type BanditScoreboard = Pick<ModelScoreboard, 'smoothedWinRate' | 'runCount'>;

export interface ModelBanditOptions {
  /** Scoreboard task category the stats are scoped to. Default `'evolve'`. */
  taskType?: string;
  /** UCB exploration coefficient `c` in `c·√(ln N / nᵢ)`. Default √2 (UCB1). */
  explorationC?: number;
  /** Cost penalty weight: `reward = quality − costAwareCoef·normalizedCost`. Default 0.5. */
  costAwareCoef?: number;
  /** Model id returned when there are no candidates / on any error (else `undefined`). */
  fallbackModel?: string;
}

/** UCB1 exploration coefficient (√2). */
const DEFAULT_EXPLORATION_C = Math.SQRT2;
/** Default cost penalty weight — half a unit of normalized cost trades against half a unit of quality. */
const DEFAULT_COST_AWARE_COEF = 0.5;
/**
 * Exploration priority for a NEVER-tried arm. Large enough to dominate any realistic
 * `reward + c·√(ln N / n)` of a tried arm, but small enough that adding a reward in [−1, 1] stays
 * exactly representable — so among several unseen arms the cheaper one (higher reward) still wins.
 */
const UNSEEN_BONUS = 1e9;

/** Treat NaN / negative / non-finite prices as $0 (a bad catalog entry must not skew the cost term). */
function safeCost(cost: number): number {
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Pick the next model to try with cost-aware UCB. Pure + never-throws.
 *
 * @param candidates the LLM catalog to choose from (with `costInputUsdPerMtok`)
 * @param scoreboard the historical stats (win rate + run count), injected
 * @param opts        exploration/cost knobs + fallback
 * @returns the chosen model id, or `opts.fallbackModel` (possibly `undefined`) when nothing qualifies
 */
export function pickModelUCB(
  candidates: readonly LlmCandidate[],
  scoreboard: BanditScoreboard,
  opts: ModelBanditOptions = {},
): string | undefined {
  const fallback = opts.fallbackModel;
  try {
    if (!candidates || candidates.length === 0) return fallback;

    const taskType = opts.taskType ?? 'evolve';
    const c = Number.isFinite(opts.explorationC) ? (opts.explorationC as number) : DEFAULT_EXPLORATION_C;
    const costCoef = Number.isFinite(opts.costAwareCoef) ? (opts.costAwareCoef as number) : DEFAULT_COST_AWARE_COEF;

    // Cost is normalized against the most expensive candidate → 0 for all when everything is $0.
    const maxCost = candidates.reduce((m, x) => Math.max(m, safeCost(x.costInputUsdPerMtok)), 0);

    // Total observations for this task type feeds the ln(N) term (clamped ≥1 so ln stays ≥0).
    let totalRuns = 0;
    const rows = candidates.map((cand) => {
      const n = Math.max(0, Math.floor(scoreboard.runCount(taskType, cand.model) || 0));
      totalRuns += n;
      return { cand, n };
    });
    const lnN = Math.log(Math.max(totalRuns, 1));

    let best: { model: string; value: number; cost: number } | undefined;
    for (const { cand, n } of rows) {
      const quality = clamp01(scoreboard.smoothedWinRate(taskType, cand.model));
      const normCost = maxCost > 0 ? safeCost(cand.costInputUsdPerMtok) / maxCost : 0;
      const reward = quality - costCoef * normCost;
      const exploration = n === 0 ? UNSEEN_BONUS : c * Math.sqrt(lnN / n);
      const value = reward + exploration;
      const cost = safeCost(cand.costInputUsdPerMtok);
      if (
        best === undefined ||
        value > best.value ||
        // Deterministic tie-break: prefer the cheaper model, then the lexically smaller id.
        (value === best.value &&
          (cost < best.cost || (cost === best.cost && cand.model.localeCompare(best.model) < 0)))
      ) {
        best = { model: cand.model, value, cost };
      }
    }
    return best?.model ?? candidates[0]?.model ?? fallback;
  } catch {
    return candidates?.[0]?.model ?? fallback;
  }
}
