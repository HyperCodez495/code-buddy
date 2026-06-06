/**
 * Paired-gate adapter for background SKILL writes (S3).
 *
 * The paired live gate (`runPairedGate`) validates a piece of TEXT by BEHAVIOUR:
 * it runs an injected agent WITH and WITHOUT the text on a set of graded tasks
 * and accepts only if the text makes the agent solve tasks it otherwise would
 * not, with statistical confidence and no safety regression. It is text-agnostic,
 * so a skill's SKILL.md can be fed as the `lessonText`.
 *
 * The honest constraint: a freshly-generated skill rarely ships with DETERMINISTIC
 * graded tasks. Rather than fabricate keyword graders (which the paired gate
 * explicitly rejects as a signal), this adapter ABSTAINS when no gradeable
 * behavioural evidence is available — the skill then falls back to the structural
 * + secret-screen + reversibility nets in `promoteSkillCandidate`. When a caller
 * DOES supply graded tasks (e.g. a skill that ships a regression harness, or a
 * future derivation from recorded run contracts), the gate runs for real and can
 * REJECT an inert / regressing / unconvincing skill.
 *
 * @module agent/learning/skill-paired-gate
 */

import {
  runPairedGate,
  type AgentRunner,
  type GradedTask,
  type PairedGateOptions,
} from '../self-improvement/paired-gate.js';
import type { ResearchScriptSkillCandidate } from '../research-script-skill-candidate.js';
import type { SkillGate, SkillGateVerdict } from './skill-background-writes.js';

export interface MakeSkillGateOptions {
  /** Injected agent runner (production wraps the headless review loop). */
  runner: AgentRunner;
  /**
   * Explicit graded tasks for this gate. When omitted, the gate tries
   * `deriveSkillGradedTasks(candidate)` and abstains if none can be derived.
   */
  tasks?: GradedTask[];
  /** Confidence threshold for the paired sign test. Default 0.95. */
  threshold?: number;
  /** Forwarded paired-gate options (earlyStop, baseLessons). */
  pairedOptions?: Omit<PairedGateOptions, 'threshold'>;
}

/**
 * Derive deterministic graded tasks from a materialized skill candidate.
 *
 * Conservative by design: returns `[]` for the generic case so the gate abstains
 * (falling back to the reversible nets) rather than rubber-stamping with a
 * keyword grader. This is the documented extension seam — when a candidate gains
 * a checkable input→expected-output run contract, emit one `GradedTask` per
 * recorded successful run whose grader asserts that contract.
 */
export function deriveSkillGradedTasks(_candidate: ResearchScriptSkillCandidate): GradedTask[] {
  return [];
}

/**
 * Build a `SkillGate` bound to an injected runner. The returned gate is the
 * `gate` option of `promoteSkillCandidate`.
 */
export function makeSkillGate(options: MakeSkillGateOptions): SkillGate {
  const threshold = options.threshold ?? 0.95;
  return async (candidate): Promise<SkillGateVerdict> => {
    const tasks = options.tasks ?? deriveSkillGradedTasks(candidate);
    if (tasks.length === 0) {
      return {
        decision: 'abstain',
        reason: 'no gradeable behavioural evidence; relying on structural + screen + reversible nets',
      };
    }

    const result = await runPairedGate(candidate.markdown, tasks, options.runner, {
      threshold,
      ...(options.pairedOptions ?? {}),
    });

    if (result.accepted) {
      return { decision: 'accept', reason: result.notes.join('; ') || 'paired gate accepted' };
    }
    return {
      decision: 'reject',
      reason: result.rejectionReason
        ? `paired gate rejected (${result.rejectionReason})`
        : 'paired gate did not accept',
    };
  };
}
