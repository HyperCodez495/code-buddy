/**
 * AI-Scientist-lite — Phase 0 experiment orchestrator.
 *
 * A THIN orchestrator that COMPOSES existing Code Buddy faculties (reasoning,
 * research/novelty, code execution, data analysis, cited synthesis, verifier
 * review, collective-knowledge ingestion) into a SINGLE, bounded, human-gated
 * research pass. It writes NO business logic of its own — every side-effecting
 * edge is an INJECTABLE boundary (`ExperimentDeps`) resolved by the CLI to the
 * real bricks and faked in tests (zero LLM / execution / network in CI).
 *
 * Security is the whole point (this loop EXECUTES generated code), so the design
 * is defensive BY CONSTRUCTION:
 *
 *   1. TWO human gates (mirrors `evolve keep --confirm`):
 *        GATE #1 — approve the idea + plan BEFORE any experiment code runs.
 *        GATE #2 — approve the report BEFORE anything is "published" (CKG ingest).
 *      Both FAIL CLOSED: a gate that is declined, times out, throws, or returns
 *      anything but an explicit `approved === true` STOPS the pass. Without a
 *      GATE #1 approval the experiment is NEVER executed; without a GATE #2
 *      approval NOTHING is ever published.
 *
 *   2. SANDBOX enforced HERE, non-bypassable: the orchestrator itself builds the
 *      execution options with `envMode: 'isolate'` (env scrub, redirected HOME,
 *      throwaway cwd, RPC off) and passes them to the injected runner. Callers
 *      cannot opt out of isolation — the mode is set by the orchestrator, not
 *      supplied by the caller.
 *
 *   3. NEVER-THROWS + BOUNDED: every stage is guarded; a failing stage degrades
 *      to a clean terminal status (never an exception), one experiment only (no
 *      autonomous multi-generation loop — that is Phase 1+), with timeouts and
 *      output caps.
 *
 * @module agent/science/experiment-orchestrator
 */

import { logger } from '../../utils/logger.js';
import type {
  ExecuteCodeInput,
  ExecuteCodeLanguage,
  ExecuteCodeResult,
  ExecuteCodeRunnerOptions,
} from '../../tools/execute-code-runner.js';
import { resolveGate } from './human-gate.js';
import type { GateDecision, HumanGateFn } from './human-gate.js';
import {
  applyEmpiricalScoring,
  type EmpiricalOutcome,
  type EmpiricalScoringConfig,
} from './experiment-empirical-gate.js';

// The human-gate primitives live in `./human-gate.js` (shared with the Phase 1
// empirical gate). Re-exported here so existing consumers keep importing them
// from the orchestrator module — a pure relocation, behaviour unchanged.
export type { GateDecision, HumanGateFn, HumanGatePrompt } from './human-gate.js';

// ============================================================================
// Data types (deliberately small — the orchestrator owns the SHAPE, the CLI
// adapts real bricks to it, tests inject fakes).
// ============================================================================

/** The hypothesis/idea the pass will test. */
export interface ScienceIdea {
  /** The falsifiable hypothesis in one or two sentences. */
  hypothesis: string;
  /** Optional short rationale / experiment sketch. */
  rationale?: string;
  /** Where the idea came from (provenance). */
  source: 'user' | 'reasoning' | 'council' | 'fallback';
}

/** A lightweight novelty verdict (the full "novelty gate" packaging is Phase 3). */
export interface NoveltyVerdict {
  /** Coarse assessment of how novel the idea looks vs prior knowledge. */
  noveltyAssessment: 'novel' | 'incremental' | 'known' | 'unknown';
  /** Human-readable supporting evidence lines (sources, prior CKG hits, …). */
  evidence: string[];
  /** One-line summary of the assessment. */
  summary: string;
}

/** The experiment program to run (authored by an agent OR supplied by the user). */
export interface ExperimentCode {
  code: string;
  language: ExecuteCodeLanguage;
}

/** Analysis of the raw execution output. */
export interface ExperimentAnalysis {
  summary: string;
  findings: string[];
}

/** The cited report synthesized from idea + execution + analysis. */
export interface ScienceReport {
  /** Markdown report (TL;DR / body / references). */
  report: string;
  /** Optional reference lines. */
  references?: string[];
}

/** An independent, fresh-context review verdict (Verifier-agent contract). */
export interface ReviewVerdict {
  verdict: 'CONFIRMED' | 'NEEDS REVIEW';
  evidence: string;
}

/** Context handed to the report synthesizer. */
export interface ReportContext {
  goal: string;
  idea: ScienceIdea;
  novelty: NoveltyVerdict;
  experimentCode: ExperimentCode;
  execution: ExecuteCodeResult;
  analysis: ExperimentAnalysis;
}

// ============================================================================
// Injectable boundaries — the real bricks are wired by the CLI, faked in tests.
// ============================================================================

export interface ExperimentDeps {
  /** Idea/hypothesis generation (reasoning-facade / council / user-supplied). */
  ideate: (goal: string) => Promise<ScienceIdea>;
  /** Lightweight novelty assessment (deep-research + CKG recall). */
  assessNovelty: (idea: ScienceIdea, goal: string) => Promise<NoveltyVerdict>;
  /** GATE #1 — approve the idea + plan BEFORE any code runs. Fail closed. */
  confirmExperiment: HumanGateFn;
  /** Author the experiment program (headless agent OR user-supplied code). */
  authorExperiment: (idea: ScienceIdea, goal: string) => Promise<ExperimentCode>;
  /**
   * Execute the experiment program. The orchestrator ALWAYS supplies
   * `options.envMode = 'isolate'`; this boundary must honour it (the real
   * runner does). Injected as `executeCode` from `execute-code-runner.ts`.
   */
  executeCode: (input: ExecuteCodeInput, options: ExecuteCodeRunnerOptions) => Promise<ExecuteCodeResult>;
  /** Analyse the raw execution output (DataAnalysis agent). */
  analyze: (execution: ExecuteCodeResult, idea: ScienceIdea) => Promise<ExperimentAnalysis>;
  /** Synthesize a cited report (deep-research `synthesize`). */
  report: (ctx: ReportContext) => Promise<ScienceReport>;
  /** Independent fresh-context review (Verifier agent, read-only). */
  review: (report: ScienceReport, idea: ScienceIdea) => Promise<ReviewVerdict>;
  /** GATE #2 — approve the report BEFORE publication. Fail closed. */
  confirmPublication: HumanGateFn;
  /** Publish the validated report (CKG ingest). Only reached after GATE #2. */
  publish: (report: ScienceReport, idea: ScienceIdea) => Promise<void>;
}

/** Bounded run-time knobs (all defaulted / clamped). */
export interface ExperimentOptions {
  /** Root dir for the sandbox run dir (default `process.cwd()`). */
  rootDir?: string;
  /** Hard timeout for the experiment execution (ms). Clamped to the runner's cap. */
  experimentTimeoutMs?: number;
  /** Progress callback (never allowed to break the run). */
  onStage?: (log: ExperimentStageLog) => void;
  /**
   * Phase 1 OPT-IN empirical scoring. When set, AFTER the experiment executes +
   * is analysed, the orchestrator scores the experiment's metric, records a
   * variant, applies the empirical keep/reject decision + the human keep-gate.
   * DECOUPLED from the repo: the scoring targets the experiment folder + metric,
   * never `src/` / `main` / the repo's tests. UNSET ⇒ Phase 0 byte-identical
   * (the fitness component + store are never even constructed).
   */
  empirical?: EmpiricalScoringConfig;
}

// ============================================================================
// Result / status
// ============================================================================

export type ExperimentStatus =
  /** GATE #1 declined ⇒ nothing executed. */
  | 'declined-at-plan-gate'
  /** Everything ran; GATE #2 declined ⇒ nothing published. */
  | 'declined-at-publish-gate'
  /** Ran + reviewed + published to the collective knowledge graph. */
  | 'published'
  /** A hard stage failure (ideation/authoring/execution) stopped the pass cleanly. */
  | 'failed';

export type ExperimentStageName =
  | 'ideate'
  | 'novelty'
  | 'plan-gate'
  | 'author'
  | 'execute'
  | 'analyze'
  // Phase 1 empirical scoring stages — only emitted when `options.empirical` is set.
  | 'score'
  | 'decide'
  | 'keep-gate'
  | 'report'
  | 'review'
  | 'publish-gate'
  | 'publish';

export interface ExperimentStageLog {
  stage: ExperimentStageName;
  ok: boolean;
  detail: string;
}

export interface ExperimentRun {
  goal: string;
  idea: ScienceIdea | null;
  novelty: NoveltyVerdict | null;
  planGate: GateDecision | null;
  experimentCode: ExperimentCode | null;
  execution: ExecuteCodeResult | null;
  analysis: ExperimentAnalysis | null;
  report: ScienceReport | null;
  review: ReviewVerdict | null;
  publishGate: GateDecision | null;
  published: boolean;
  status: ExperimentStatus;
  stages: ExperimentStageLog[];
  /**
   * Phase 1 empirical outcome — PRESENT ONLY when `options.empirical` was set.
   * Undefined otherwise (Phase 0 result is byte-identical without the option).
   */
  empirical?: EmpiricalOutcome;
  /** Set when a hard stage failed (status === 'failed'). */
  error?: string;
}

// ============================================================================
// Orchestration
// ============================================================================

/** The sandbox mode the orchestrator ALWAYS enforces. Not caller-overridable. */
const SANDBOX_ENV_MODE: NonNullable<ExecuteCodeRunnerOptions['envMode']> = 'isolate';

/**
 * Run ONE bounded, human-gated experiment pass. Never throws: every stage is
 * guarded and any failure degrades to a terminal {@link ExperimentStatus}.
 *
 * The two human gates FAIL CLOSED — without an explicit `approved === true`
 * the experiment is not executed (GATE #1) and nothing is published (GATE #2).
 */
export async function runExperiment(
  goal: string,
  deps: ExperimentDeps,
  options: ExperimentOptions = {},
): Promise<ExperimentRun> {
  const run: ExperimentRun = {
    goal,
    idea: null,
    novelty: null,
    planGate: null,
    experimentCode: null,
    execution: null,
    analysis: null,
    report: null,
    review: null,
    publishGate: null,
    published: false,
    status: 'failed',
    stages: [],
  };

  const stage = (log: ExperimentStageLog): void => {
    run.stages.push(log);
    try {
      options.onStage?.(log);
    } catch {
      /* progress must never break the pass */
    }
  };

  try {
    const trimmedGoal = typeof goal === 'string' ? goal.trim() : '';
    if (!trimmedGoal) {
      run.error = 'goal is required';
      stage({ stage: 'ideate', ok: false, detail: run.error });
      return run;
    }

    // ── 1. Idea / hypothesis ────────────────────────────────────────────────
    try {
      run.idea = await deps.ideate(trimmedGoal);
    } catch (err) {
      run.error = `ideation failed: ${errMsg(err)}`;
      stage({ stage: 'ideate', ok: false, detail: run.error });
      return run;
    }
    if (!run.idea || !run.idea.hypothesis.trim()) {
      run.error = 'ideation produced no hypothesis';
      stage({ stage: 'ideate', ok: false, detail: run.error });
      return run;
    }
    stage({ stage: 'ideate', ok: true, detail: `[${run.idea.source}] ${run.idea.hypothesis}` });

    // ── 2. Novelty (degrades to "unknown", never blocks) ────────────────────
    try {
      run.novelty = await deps.assessNovelty(run.idea, trimmedGoal);
    } catch (err) {
      run.novelty = degradedNovelty(`novelty assessment failed: ${errMsg(err)}`);
    }
    if (!run.novelty) run.novelty = degradedNovelty('novelty assessment returned nothing');
    stage({ stage: 'novelty', ok: true, detail: `${run.novelty.noveltyAssessment} — ${run.novelty.summary}` });

    // ── GATE #1: approve idea + plan BEFORE any code runs (FAIL CLOSED) ──────
    run.planGate = await resolveGate(deps.confirmExperiment, {
      gate: 'plan',
      title: 'Approve experiment plan before running generated code',
      body: buildPlanGateBody(trimmedGoal, run.idea, run.novelty),
    });
    stage({
      stage: 'plan-gate',
      ok: run.planGate.approved,
      detail: run.planGate.approved ? 'approved' : `declined${run.planGate.reason ? `: ${run.planGate.reason}` : ''}`,
    });
    if (!run.planGate.approved) {
      // CRITICAL: the experiment is NEVER executed without an explicit approval.
      run.status = 'declined-at-plan-gate';
      return run;
    }

    // ── 3. Author the experiment program ────────────────────────────────────
    try {
      run.experimentCode = await deps.authorExperiment(run.idea, trimmedGoal);
    } catch (err) {
      run.error = `authoring failed: ${errMsg(err)}`;
      stage({ stage: 'author', ok: false, detail: run.error });
      return run;
    }
    if (!run.experimentCode || !run.experimentCode.code.trim()) {
      run.error = 'authoring produced no experiment code';
      stage({ stage: 'author', ok: false, detail: run.error });
      return run;
    }
    stage({
      stage: 'author',
      ok: true,
      detail: `${run.experimentCode.language}, ${run.experimentCode.code.length} chars`,
    });

    // ── 4. Execute the experiment — SANDBOXED (isolate), non-bypassable ──────
    const execInput: ExecuteCodeInput = {
      code: run.experimentCode.code,
      language: run.experimentCode.language,
      timeoutMs: options.experimentTimeoutMs,
    };
    const execOptions: ExecuteCodeRunnerOptions = {
      // The orchestrator OWNS these — isolation is set here, not by the caller.
      envMode: SANDBOX_ENV_MODE,
      rootDir: options.rootDir ?? process.cwd(),
    };
    try {
      run.execution = await deps.executeCode(execInput, execOptions);
    } catch (err) {
      // The real runner never throws (it returns a result with `error`), but a
      // fake / unexpected failure must not crash the pass.
      run.error = `execution failed: ${errMsg(err)}`;
      stage({ stage: 'execute', ok: false, detail: run.error });
      return run;
    }
    // A non-zero exit is a VALID scientific outcome (the hypothesis may fail);
    // we continue to analysis/report rather than aborting.
    stage({
      stage: 'execute',
      ok: run.execution.ok,
      detail: run.execution.ok
        ? `exit ${run.execution.exitCode} in ${run.execution.durationMs}ms`
        : `non-zero/failed: ${run.execution.error ?? `exit ${run.execution.exitCode}`}`,
    });

    // ── 5. Analyse the raw output (degrades gracefully) ──────────────────────
    try {
      run.analysis = await deps.analyze(run.execution, run.idea);
    } catch (err) {
      run.analysis = degradedAnalysis(run.execution, `analysis failed: ${errMsg(err)}`);
    }
    if (!run.analysis) run.analysis = degradedAnalysis(run.execution, 'analysis returned nothing');
    stage({ stage: 'analyze', ok: true, detail: run.analysis.summary });

    // ── Phase 1 (OPT-IN): empirical scoring / keep-gate / archive ────────────
    // Additive and DECOUPLED: only runs when `options.empirical` is set; scores
    // the experiment's own metric in the experiment folder (never the repo).
    // never-throws — a scoring failure degrades and the Phase 0 pass continues.
    if (options.empirical) {
      try {
        const empirical = await applyEmpiricalScoring(
          {
            hypothesis: run.idea.hypothesis,
            code: run.experimentCode.code,
            language: run.experimentCode.language,
            execution: run.execution,
          },
          options.empirical,
        );
        run.empirical = empirical;
        for (const s of empirical.stages) {
          stage({ stage: s.stage, ok: s.ok, detail: s.detail });
        }
      } catch (err) {
        // applyEmpiricalScoring never throws, but guard defensively anyway.
        stage({ stage: 'score', ok: false, detail: `empirical scoring failed: ${errMsg(err)}` });
      }
    }

    // ── 6. Synthesize the cited report (degrades to a deterministic report) ──
    const reportCtx: ReportContext = {
      goal: trimmedGoal,
      idea: run.idea,
      novelty: run.novelty,
      experimentCode: run.experimentCode,
      execution: run.execution,
      analysis: run.analysis,
    };
    try {
      run.report = await deps.report(reportCtx);
    } catch (err) {
      run.report = degradedReport(reportCtx, `report synthesis failed: ${errMsg(err)}`);
    }
    if (!run.report || !run.report.report.trim()) {
      run.report = degradedReport(reportCtx, 'report synthesis returned nothing');
    }
    stage({ stage: 'report', ok: true, detail: `${run.report.report.length} chars` });

    // ── 7. Independent review (degrades to NEEDS REVIEW) ─────────────────────
    try {
      run.review = await deps.review(run.report, run.idea);
    } catch (err) {
      run.review = { verdict: 'NEEDS REVIEW', evidence: `review failed: ${errMsg(err)}` };
    }
    if (!run.review) run.review = { verdict: 'NEEDS REVIEW', evidence: 'review returned nothing' };
    stage({ stage: 'review', ok: run.review.verdict === 'CONFIRMED', detail: run.review.verdict });

    // ── GATE #2: approve the report BEFORE publication (FAIL CLOSED) ─────────
    run.publishGate = await resolveGate(deps.confirmPublication, {
      gate: 'publish',
      title: 'Approve report before publishing to the collective knowledge graph',
      body: buildPublishGateBody(run.report, run.review),
    });
    stage({
      stage: 'publish-gate',
      ok: run.publishGate.approved,
      detail: run.publishGate.approved
        ? 'approved'
        : `declined${run.publishGate.reason ? `: ${run.publishGate.reason}` : ''}`,
    });
    if (!run.publishGate.approved) {
      // CRITICAL: nothing is ever published without an explicit approval.
      run.status = 'declined-at-publish-gate';
      return run;
    }

    // ── 8. Publish (CKG ingest) — only reached after BOTH gates approved ─────
    try {
      await deps.publish(run.report, run.idea);
      run.published = true;
      run.status = 'published';
      stage({ stage: 'publish', ok: true, detail: 'ingested into the collective knowledge graph' });
    } catch (err) {
      // Publication failure ⇒ we ran + were approved, but nothing landed.
      run.published = false;
      run.status = 'declined-at-publish-gate';
      run.error = `publication failed: ${errMsg(err)}`;
      stage({ stage: 'publish', ok: false, detail: run.error });
    }
    return run;
  } catch (err) {
    // Final safety net — runExperiment NEVER throws.
    run.status = 'failed';
    run.error = `unexpected orchestrator error: ${errMsg(err)}`;
    try {
      logger.warn(`[science] ${run.error}`);
    } catch {
      /* logging must never break the pass */
    }
    return run;
  }
}

// ============================================================================
// Deterministic fallbacks (keep the pass never-throwing + honest)
// ============================================================================

function degradedNovelty(reason: string): NoveltyVerdict {
  return { noveltyAssessment: 'unknown', evidence: [reason], summary: 'novelty could not be assessed' };
}

function degradedAnalysis(execution: ExecuteCodeResult, reason: string): ExperimentAnalysis {
  const stdout = (execution.stdout || '').trim();
  const findings: string[] = [];
  if (stdout) findings.push(`stdout (${stdout.length} chars) captured`);
  if (execution.stderr?.trim()) findings.push('stderr present');
  findings.push(`exit ${execution.exitCode ?? 'unknown'}${execution.timedOut ? ' (timed out)' : ''}`);
  return { summary: reason, findings };
}

function degradedReport(ctx: ReportContext, reason: string): ScienceReport {
  const exec = ctx.execution;
  const body = [
    `# Experiment Report: ${ctx.goal}`,
    '',
    '## TL;DR',
    '',
    `Rapport déterministe (synthèse LLM indisponible : ${reason}).`,
    '',
    '## Hypothèse',
    '',
    ctx.idea.hypothesis,
    '',
    '## Nouveauté',
    '',
    `${ctx.novelty.noveltyAssessment} — ${ctx.novelty.summary}`,
    '',
    '## Résultat d\'exécution (sandbox isolate)',
    '',
    `- statut : ${exec.ok ? 'ok' : 'échec'} (exit ${exec.exitCode ?? 'unknown'}${exec.timedOut ? ', timeout' : ''})`,
    `- durée : ${exec.durationMs}ms`,
    ...(exec.stdout.trim() ? ['', '```', truncate(exec.stdout, 2000), '```'] : []),
    '',
    '## Analyse',
    '',
    ctx.analysis.summary,
    ...ctx.analysis.findings.map((f) => `- ${f}`),
  ].join('\n');
  return { report: body };
}

// ============================================================================
// Gate prompt bodies
// ============================================================================

function buildPlanGateBody(goal: string, idea: ScienceIdea, novelty: NoveltyVerdict): string {
  return [
    `Objectif : ${goal}`,
    '',
    `Hypothèse [${idea.source}] : ${idea.hypothesis}`,
    ...(idea.rationale ? ['', `Plan : ${idea.rationale}`] : []),
    '',
    `Nouveauté : ${novelty.noveltyAssessment} — ${novelty.summary}`,
    ...(novelty.evidence.length ? ['Preuves :', ...novelty.evidence.map((e) => `  - ${e}`)] : []),
    '',
    "⚠️  Approuver lance l'exécution de code GÉNÉRÉ dans un bac à sable isolé (envMode=isolate).",
  ].join('\n');
}

function buildPublishGateBody(report: ScienceReport, review: ReviewVerdict): string {
  return [
    `Revue indépendante : ${review.verdict}`,
    `  ${truncate(review.evidence, 400)}`,
    '',
    'Rapport (extrait) :',
    truncate(report.report, 1200),
    '',
    '⚠️  Approuver INGÈRE le rapport dans le graphe de connaissances collectif (publication).',
  ].join('\n');
}

// ============================================================================
// Small helpers
// ============================================================================

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function truncate(text: string, max: number): string {
  const t = typeof text === 'string' ? text : String(text);
  return t.length <= max ? t : `${t.slice(0, max)}… [tronqué]`;
}
