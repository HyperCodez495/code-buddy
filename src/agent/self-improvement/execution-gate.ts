/**
 * Execution-grounded validation (deterministic subclass).
 *
 * The retrieval benchmark (capability-benchmark.ts) measures whether on-topic
 * guidance is *retrievable* — a proxy that a wrong-but-on-topic lesson can pass.
 * This module fixes that for the subclass of improvements that encode a CHECKABLE
 * BEHAVIORAL RULE (e.g. "a safe-profile run must not call a mutation tool"): it
 * validates a proposed rule by how well it CORRECTLY CLASSIFIES real recorded
 * trajectories — does it flag the bad runs and pass the good ones — exactly as
 * the Darwin Gödel Machine gates on execution outcomes, but deterministic and
 * cheap (no live agent, no LLM-judge, reproducible).
 *
 * It is grounded in the recorded behavior the agent actually produced
 * (RunStore trajectories / golden+policy eval fixtures), so a "+1" reflects real
 * correctness on held-out runs, not keyword presence. A counterfactual-ablation
 * pre-filter rejects rules that change no verdict (inert), and a no-regression
 * guard rejects rules that misclassify an already-correct run.
 *
 * @module agent/self-improvement/execution-gate
 */

/** A compact, deterministic view of a recorded run (adapt from RunTrajectoryExport). */
export interface TrajectorySummary {
  /** Tool names invoked, in order. */
  toolNames: string[];
  /** Concatenated text surface (final answer + notable outputs), lowercased on check. */
  text: string;
  /** Optional profile/scope signal (e.g. 'safe', 'review'). */
  profile?: string;
}

/** A deterministic predicate over a trajectory — mirrors the golden/policy eval vocab. */
export type BehavioralCheck =
  | { kind: 'forbid_tool'; pattern: string }
  | { kind: 'require_tool'; pattern: string }
  | { kind: 'forbid_text'; pattern: string }
  | { kind: 'require_text'; pattern: string };

/** A labeled example: should this trajectory be considered compliant? */
export interface LabeledTrajectory {
  id: string;
  trajectory: TrajectorySummary;
  shouldPass: boolean;
}

/** A proposed behavioral rule to add to the active rule set. */
export interface BehavioralRuleProposal {
  id: string;
  /** Human-readable statement (the lesson text). */
  statement: string;
  check: BehavioralCheck;
}

function compile(pattern: string): RegExp {
  // Escape nothing — patterns are author-controlled, but anchor on word-ish match.
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
}

/** True when the trajectory satisfies the check (i.e. the check "passes"). */
export function evaluateCheck(check: BehavioralCheck, t: TrajectorySummary): boolean {
  const re = compile(check.pattern);
  switch (check.kind) {
    case 'forbid_tool':
      return !t.toolNames.some((n) => re.test(n));
    case 'require_tool':
      return t.toolNames.some((n) => re.test(n));
    case 'forbid_text':
      return !re.test(t.text);
    case 'require_text':
      return re.test(t.text);
  }
}

/** A trajectory is compliant under a rule set iff EVERY rule passes. */
export function verdict(rules: BehavioralCheck[], t: TrajectorySummary): boolean {
  return rules.every((r) => evaluateCheck(r, t));
}

export interface CorpusScore {
  total: number;
  correct: number;
  accuracy: number;
  /** Per-trajectory: was the verdict correct vs its label? */
  results: Array<{ id: string; verdict: boolean; shouldPass: boolean; correct: boolean }>;
}

/** Classification accuracy of a rule set over the labeled corpus. Deterministic. */
export function scoreCorpus(rules: BehavioralCheck[], corpus: LabeledTrajectory[]): CorpusScore {
  const results = corpus.map((c) => {
    const v = verdict(rules, c.trajectory);
    return { id: c.id, verdict: v, shouldPass: c.shouldPass, correct: v === c.shouldPass };
  });
  const correct = results.filter((r) => r.correct).length;
  const total = corpus.length;
  return { total, correct, accuracy: total === 0 ? 1 : correct / total, results };
}

export type ExecutionRejectionReason = 'inert' | 'no-improvement' | 'regression';

export interface ExecutionGateOutcome {
  accepted: boolean;
  proposalId: string;
  accuracyBefore: number;
  accuracyAfter: number;
  delta: number;
  /** Trajectory ids that were correct before and wrong after (any ⇒ reject). */
  regressions: string[];
  /** Trajectory ids whose verdict the rule changed (empty ⇒ inert). */
  changed: string[];
  rejectionReason?: ExecutionRejectionReason;
  notes: string[];
}

/**
 * Validate a behavioral-rule proposal against the recorded-trajectory corpus.
 * Accept iff it (a) changes at least one verdict (not inert), (b) raises
 * classification accuracy, and (c) regresses no already-correct trajectory.
 */
export function validateBehavioralRule(
  proposal: BehavioralRuleProposal,
  currentRules: BehavioralCheck[],
  corpus: LabeledTrajectory[],
): ExecutionGateOutcome {
  const before = scoreCorpus(currentRules, corpus);
  const after = scoreCorpus([...currentRules, proposal.check], corpus);

  // Counterfactual ablation: which verdicts did the new rule actually change?
  const changed = corpus
    .filter((c) => verdict(currentRules, c.trajectory) !== verdict([...currentRules, proposal.check], c.trajectory))
    .map((c) => c.id);

  if (changed.length === 0) {
    return {
      accepted: false, proposalId: proposal.id,
      accuracyBefore: before.accuracy, accuracyAfter: after.accuracy, delta: 0,
      regressions: [], changed: [], rejectionReason: 'inert',
      notes: ['rule changes no recorded behavior — inert, rejected before scoring'],
    };
  }

  // No-regression: a trajectory correct before must not become wrong.
  const afterById = new Map(after.results.map((r) => [r.id, r.correct]));
  const regressions = before.results
    .filter((r) => r.correct && afterById.get(r.id) === false)
    .map((r) => r.id);

  const delta = after.correct - before.correct;
  if (regressions.length > 0) {
    return {
      accepted: false, proposalId: proposal.id,
      accuracyBefore: before.accuracy, accuracyAfter: after.accuracy, delta,
      regressions, changed, rejectionReason: 'regression',
      notes: [`misclassifies ${regressions.length} previously-correct run(s)`],
    };
  }
  if (delta <= 0) {
    return {
      accepted: false, proposalId: proposal.id,
      accuracyBefore: before.accuracy, accuracyAfter: after.accuracy, delta,
      regressions: [], changed, rejectionReason: 'no-improvement',
      notes: ['changes behavior but does not improve classification accuracy'],
    };
  }

  return {
    accepted: true, proposalId: proposal.id,
    accuracyBefore: before.accuracy, accuracyAfter: after.accuracy, delta,
    regressions: [], changed,
    notes: [`correctly reclassifies ${delta} recorded run(s) with no regression`],
  };
}

/** Adapt a full run-trajectory export (shape-tolerant) into a TrajectorySummary. */
export function summarizeTrajectory(exported: unknown): TrajectorySummary {
  const e = (exported ?? {}) as {
    toolCalls?: Array<{ toolName?: string }>;
    finalAnswer?: string | null;
    selectedContext?: { profileSignal?: string };
  };
  const toolNames = (e.toolCalls ?? []).map((c) => c.toolName ?? '').filter(Boolean);
  const text = (e.finalAnswer ?? '').toString();
  const profile = e.selectedContext?.profileSignal;
  return { toolNames, text, ...(profile ? { profile } : {}) };
}
