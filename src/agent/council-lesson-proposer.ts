/**
 * Council → lesson-candidate bridge (closes autonomy loop link [1]).
 *
 * The Fleet Council asks the same goal to N peers and produces a deterministic
 * consensus summary (agreement score + divergences). A council outcome that
 * DIVERGED — or only reached sub-threshold agreement — is a learnable signal:
 * the peers disagreed, so there's something worth capturing. This helper turns
 * such an outcome into a PROPOSED lesson candidate for human review.
 *
 * It deliberately reuses the same "propose → review → approve, no silent write"
 * discipline as the rest of the learning loop: it only ever calls
 * `LessonCandidateQueue.propose()` (never writes `lessons.md`), so the operator
 * still gates what becomes durable procedural memory. Approved lessons are then
 * re-injected into future sagas via `loadRelevantSagaLessons` — the loop closes.
 *
 * Pure and host-agnostic: callers (Cowork's saga-runner today, a CLI/server
 * hook later) pass primitives + an explicit `workDir`, so this never depends on
 * `process.cwd()`.
 *
 * @module agent/council-lesson-proposer
 */

import { createHash } from 'node:crypto';
import { getLessonCandidateQueue, type LessonCandidate } from './lesson-candidate-queue.js';
import { logger } from '../utils/logger.js';

export interface CouncilConsensusInput {
  score: number;
  threshold: number;
  total: number;
  disagreements: Array<{ peerId: string; model: string; preview?: string }>;
}

export interface CouncilOutcomeInput {
  sagaId: string;
  goal: string;
  /** Expected to be 'consensus' for a council saga; anything else is skipped. */
  aggregation?: string;
  consensus: CouncilConsensusInput;
}

export interface ProposeFromCouncilResult {
  proposed: boolean;
  reason?: string;
  candidate?: LessonCandidate;
}

/**
 * Propose a review lesson candidate from a council outcome, gated and deduped.
 * Never throws — returns a structured result the caller can log/surface.
 */
export function proposeFromCouncilOutcome(
  input: CouncilOutcomeInput,
  workDir: string,
): ProposeFromCouncilResult {
  // Gate 1 — only council (consensus) sagas.
  if (input.aggregation !== 'consensus') {
    return { proposed: false, reason: 'not a council saga' };
  }

  // Gate 2 — only when there's something to learn: a divergence or
  // sub-threshold agreement. A unanimous council produces noise lessons.
  const disagreements = input.consensus?.disagreements ?? [];
  const hasDivergence = disagreements.length > 0;
  const score = input.consensus?.score;
  const threshold = input.consensus?.threshold;
  const lowConsensus =
    typeof score === 'number' && typeof threshold === 'number' && score < threshold;
  if (!hasDivergence && !lowConsensus) {
    return { proposed: false, reason: 'full agreement — nothing to learn' };
  }

  if (!workDir) {
    return { proposed: false, reason: 'no workDir' };
  }

  let queue;
  try {
    queue = getLessonCandidateQueue(workDir);
  } catch (err) {
    logger.warn('[council-lesson] queue unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { proposed: false, reason: 'queue unavailable' };
  }

  // Gate 3 — saga-level dedup. The queue's content-level dedup won't catch
  // re-finalisations/retries (content can vary), so skip if this saga already
  // has a pending candidate.
  try {
    const existing = queue
      .list('pending')
      .find((c) => c.provenance?.sagaId === input.sagaId);
    if (existing) {
      return { proposed: false, reason: 'already proposed for this saga', candidate: existing };
    }
  } catch {
    // Non-fatal — fall through and let propose() de-dup on content.
  }

  try {
    const { candidate } = queue.propose({
      category: 'INSIGHT',
      content: buildContent(input),
      context: `Fleet council · saga ${input.sagaId}`,
      source: 'self_observed',
      provenance: { sagaId: input.sagaId, note: 'auto-proposed from fleet council outcome' },
    });
    return { proposed: true, candidate };
  } catch (err) {
    logger.warn('[council-lesson] propose failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { proposed: false, reason: 'propose failed' };
  }
}

/**
 * CLI-council variant of {@link proposeFromCouncilOutcome} — same review
 * queue, same never-throw discipline, but gated on the council's DECISION
 * signals instead of raw lexical divergence. In collective (conductor) mode
 * the role-specialised answers diverge lexically BY DESIGN (an Architect and
 * a Reviewer should not use the same words — `council/signals.ts` ignores the
 * lexical term there for the same reason), so the saga gate would propose a
 * noise candidate on nearly every run. Structural primitives, no import from
 * `council/` — mirrors the saga-runner's duck-typed shape.
 */
export interface CouncilRunLessonInput {
  task: string;
  planMode: 'direct' | 'collective';
  confidence: 'high' | 'medium' | 'low';
  verdictKind: 'judged' | 'abstained';
  consensus: CouncilConsensusInput;
}

export function proposeFromCouncilRunResult(
  input: CouncilRunLessonInput,
  workDir: string,
): ProposeFromCouncilResult {
  const disagreements = input.consensus?.disagreements ?? [];
  const lexicalDisagreement =
    disagreements.length > 0 ||
    (typeof input.consensus?.score === 'number' &&
      typeof input.consensus?.threshold === 'number' &&
      input.consensus.score < input.consensus.threshold);

  const learnable =
    input.verdictKind === 'abstained' ||
    input.confidence === 'low' ||
    (input.planMode === 'direct' && lexicalDisagreement);
  if (!learnable) {
    return { proposed: false, reason: 'no learnable disagreement signal' };
  }

  // Stable per-question id: re-running the same task must hit the existing
  // saga-level dedup (gate 3) instead of piling up near-duplicate candidates
  // (a per-run timestamp id would make that gate dead code).
  const sagaId = `cli:${createHash('sha256').update(input.task.trim().toLowerCase()).digest('hex').slice(0, 16)}`;

  return proposeFromCouncilOutcome(
    {
      sagaId,
      goal: input.task,
      aggregation: 'consensus',
      consensus: input.consensus,
    },
    workDir,
  );
}

function buildContent(input: CouncilOutcomeInput): string {
  const pct = (n: number | undefined): string => `${Math.round((n ?? 0) * 100)}%`;
  const goal = input.goal.length > 80 ? `${input.goal.slice(0, 77)}...` : input.goal;
  const parts = [
    `Fleet Council on "${goal}": consensus ${pct(input.consensus.score)} ` +
      `(threshold ${pct(input.consensus.threshold)}) across ${input.consensus.total} peers.`,
  ];
  const disagreements = input.consensus.disagreements ?? [];
  if (disagreements.length > 0) {
    const who = disagreements
      .slice(0, 2)
      .map((d) => `${d.peerId}×${d.model}`)
      .join(', ');
    parts.push(
      `Diverging: ${who}. Review which position was correct and capture the resolution as a durable lesson.`,
    );
  } else {
    parts.push('Consensus stayed below threshold — verify the agreed answer before relying on it.');
  }
  return parts.join(' ');
}
