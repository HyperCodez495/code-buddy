/**
 * AI-Scientist-lite — Phase 1: the generalised empirical gate.
 *
 * Wires the four Phase-1 bricks into ONE never-throwing step, DECOUPLED from the
 * repo (it scores the EXPERIMENT's metric in the EXPERIMENT folder, never `src/`
 * / `main` / the repo's tests):
 *
 *   1. score   → `experimentFitnessComponent` (reuses the captured Phase-0 run
 *                via `cachedExecutionRunner` — no double execution) fed through
 *                `computeFitness` (`scoreExperiment`).
 *   2. decide  → `decideKeep` vs an EXPERIMENT baseline (parent variant / a
 *                supplied baseline), reusing `detectRegressions`.
 *   3. keep-gate → the human confirms BEFORE a variant is marked kept
 *                (`resolveGate`, fail closed). No confirmation ⇒ NOT kept.
 *   4. archive → the variant is ALWAYS recorded (auditable) but `kept` reflects
 *                the gate: rollback = archived, never kept/published.
 *
 * Everything is injected (metric parser, store, keep-gate, id + timestamp
 * generators), so it is fully testable with zero LLM / execution / clock.
 *
 * @module agent/science/experiment-empirical-gate
 */

import type { ExecuteCodeLanguage, ExecuteCodeResult } from '../../tools/execute-code-runner.js';
import type { FitnessContext, FitnessReport } from '../self-improvement/evolution/variant-fitness.js';
import {
  cachedExecutionRunner,
  experimentFitnessComponent,
  type MetricParser,
} from './experiment-fitness.js';
import { decideKeep, scoreExperiment, type DecideKeepOptions, type KeepDecision } from './experiment-decision.js';
import {
  ExperimentVariantStore,
  type ExperimentVariantMetric,
  type ExperimentVariantRecord,
} from './experiment-variant-store.js';
import { resolveGate, type GateDecision, type HumanGateFn } from './human-gate.js';

/** The already-run experiment the empirical gate scores. */
export interface EmpiricalScoringInput {
  hypothesis: string;
  code: string;
  language: ExecuteCodeLanguage;
  /** The captured Phase-0 execution (its `runDir` is the experiment folder). */
  execution: ExecuteCodeResult;
}

/** Injected boundaries + knobs for one empirical scoring pass. */
export interface EmpiricalScoringConfig {
  /** Metric extraction boundary (stdout / result.json). */
  parseMetric: MetricParser;
  /** Append-only variant store (never publishes). */
  store: ExperimentVariantStore;
  /** Human keep-gate — fail closed (no approval ⇒ not kept). */
  confirmKeep: HumanGateFn;
  /** Injected id generator (no Math.random here). */
  createId: () => string;
  /** Injected ISO-8601 timestamp (no Date.now here). */
  now: () => string;
  /** Experiment baseline to beat (parent variant / supplied). NEVER `main`. */
  baseline?: FitnessReport;
  /** Genealogy: the parent variant id. */
  parentId?: string;
  /** Component weight (default 1). */
  weight?: number;
  /** Metric/component name (default 'experiment-metric'). */
  metricName?: string;
  /** Keep/reject thresholds. */
  decideOptions?: DecideKeepOptions;
}

export type EmpiricalStageName = 'score' | 'decide' | 'keep-gate';

export interface EmpiricalStageLog {
  stage: EmpiricalStageName;
  ok: boolean;
  detail: string;
}

export interface EmpiricalOutcome {
  fitness: FitnessReport;
  decision: KeepDecision;
  /** Null when the decision was reject (no gate asked) or on early failure. */
  keepGate: GateDecision | null;
  /** The id of the archived variant (empty on a hard internal failure). */
  variantId: string;
  /** True ONLY when the decision was keep AND the human approved. */
  kept: boolean;
  stages: EmpiricalStageLog[];
}

function floorReport(reason: string): FitnessReport {
  return {
    score: 0,
    passedAll: false,
    components: [{ name: 'experiment-metric', weight: 1, score: 0, passed: false, detail: reason }],
    regressions: [],
  };
}

/**
 * Run ONE empirical scoring pass over an already-executed experiment. Never
 * throws: any internal failure degrades to a floor outcome (score 0, not kept).
 */
export async function applyEmpiricalScoring(
  input: EmpiricalScoringInput,
  config: EmpiricalScoringConfig,
): Promise<EmpiricalOutcome> {
  const stages: EmpiricalStageLog[] = [];
  try {
    // ── 1. Score — reuse the captured execution, isolate + experiment folder ──
    const component = experimentFitnessComponent({
      code: input.code,
      language: input.language,
      executeCode: cachedExecutionRunner(input.execution),
      parseMetric: config.parseMetric,
      ...(config.metricName ? { name: config.metricName } : {}),
      ...(config.weight !== undefined ? { weight: config.weight } : {}),
    });
    // DECOUPLING: the fitness context points at the EXPERIMENT folder (the
    // sandbox run dir), never the repo.
    const ctx: FitnessContext = { checkoutDir: input.execution.runDir };

    let fitness: FitnessReport;
    try {
      fitness = await scoreExperiment(ctx, [component], config.baseline);
    } catch (err) {
      fitness = floorReport(`scoring failed (floored): ${errMsg(err)}`);
    }
    stages.push({ stage: 'score', ok: fitness.passedAll, detail: `fitness ${fitness.score.toFixed(3)}` });

    // ── 2. Decide vs the EXPERIMENT baseline ─────────────────────────────────
    const decision = decideKeep(fitness, config.baseline, config.decideOptions);
    stages.push({
      stage: 'decide',
      ok: decision.keep,
      detail: `${decision.keep ? 'keep' : 'reject'} — ${decision.reason}`,
    });

    // ── 3. Keep-gate (fail closed) — only asked when the decision says keep ───
    let keepGate: GateDecision | null = null;
    if (decision.keep) {
      keepGate = await resolveGate(config.confirmKeep, {
        gate: 'keep',
        title: 'Approve keeping this experiment variant',
        body: buildKeepGateBody(input, fitness, decision),
      });
    }
    const kept = decision.keep && keepGate?.approved === true;
    stages.push({
      stage: 'keep-gate',
      ok: kept,
      detail: decision.keep
        ? kept
          ? 'approved'
          : `declined${keepGate?.reason ? `: ${keepGate.reason}` : ''}`
        : 'skipped (decision=reject)',
    });

    // ── 4. Archive the variant ALWAYS (kept reflects the gate) ───────────────
    const mc = fitness.components[0];
    const metric: ExperimentVariantMetric = {
      name: mc?.name ?? config.metricName ?? 'experiment-metric',
      value: typeof mc?.metrics?.value === 'number' ? mc.metrics.value : null,
      score: mc?.score ?? 0,
      detail: mc?.detail ?? 'no metric',
    };
    const variantId = config.createId();
    const record: ExperimentVariantRecord = {
      id: variantId,
      hypothesis: input.hypothesis,
      code: input.code,
      language: input.language,
      executionResult: {
        ok: input.execution.ok,
        exitCode: input.execution.exitCode,
        timedOut: input.execution.timedOut,
        runId: input.execution.runId,
        runDir: input.execution.runDir,
        durationMs: input.execution.durationMs,
      },
      metric,
      score: fitness.score,
      passedAll: fitness.passedAll,
      regressions: decision.regressions,
      ...(config.parentId ? { parentId: config.parentId } : {}),
      kept,
      createdAt: config.now(),
      detail: decision.reason,
    };
    config.store.record(record);

    return { fitness, decision, keepGate, variantId, kept, stages };
  } catch (err) {
    // Final safety net — this step NEVER throws.
    const fitness = floorReport(`empirical gate failed (floored): ${errMsg(err)}`);
    const decision: KeepDecision = {
      keep: false,
      reason: `empirical gate failed: ${errMsg(err)}`,
      delta: 0,
      regressions: [],
    };
    if (stages.length === 0) {
      stages.push({ stage: 'score', ok: false, detail: decision.reason });
    }
    return { fitness, decision, keepGate: null, variantId: '', kept: false, stages };
  }
}

function buildKeepGateBody(input: EmpiricalScoringInput, fitness: FitnessReport, decision: KeepDecision): string {
  return [
    `Hypothèse : ${input.hypothesis}`,
    '',
    `Fitness mesurée : ${fitness.score.toFixed(3)} (passedAll=${fitness.passedAll})`,
    `Décision empirique : keep — ${decision.reason}`,
    `Delta vs baseline : ${decision.delta.toFixed(3)}`,
    ...(decision.regressions.length ? [`Régressions : ${decision.regressions.join(', ')}`] : []),
    '',
    '⚠️  Approuver marque ce variant comme GARDÉ (archivé comme stepping-stone). Refuser = archivé mais non gardé.',
  ].join('\n');
}

/** Convenience factory for the default store (kept out of the hot path). */
export function defaultExperimentVariantStore(path?: string): ExperimentVariantStore {
  return new ExperimentVariantStore(path);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
