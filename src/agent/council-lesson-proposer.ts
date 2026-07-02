/**
 * Council → lesson-candidate bridge (closes autonomy loop link [1]).
 *
 * The council asks the same goal to N members/peers; a divergence CAN be a
 * learnable signal — but replaying real transcripts showed the naive version
 * produced mostly noise: 3 of 4 proposals existed only because the judge DIED
 * (infrastructure, not knowledge), every candidate was the same
 * metadata-plus-TODO template ("consensus 8%, X and Y diverged, review which
 * position was correct") carrying none of the actual positions, and the one
 * run with a genuinely reusable RESOLVED disagreement was skipped.
 *
 * The bridge now extracts SUBSTANCE and scores PEDAGOGICAL VALUE:
 *  - a candidate carries the opposing positions (VERDICT lines / previews)
 *    and the resolution (winner, rationale, what the judge re-verified);
 *  - `scorePedagogicalValue()` rates generalizability, non-contingency,
 *    testability, substance and real stance divergence — pure TS, no LLM,
 *    deterministic and auditable (same philosophy as the DHI);
 *  - infra noise (judge abstained) NEVER proposes — that signal belongs to
 *    the scoreboard's failure ledger, not to procedural memory;
 *  - the score is stored in the candidate's provenance so the human reviewer
 *    can triage the queue by value.
 *
 * Same "propose → review → approve, no silent write" discipline as before:
 * only `LessonCandidateQueue.propose()`, never `lessons.md`.
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

/** One member's position — label (role or model) + its stance (VERDICT line / preview). */
export interface CouncilPosition {
  label: string;
  stance: string;
}

/** How the disagreement was settled, when it was. */
export interface CouncilResolution {
  winner?: string;
  rationale?: string;
  /** What the judge re-verified itself (counts, computations). */
  verified?: string;
}

// ---------------------------------------------------------------------------
// Pedagogical value — deterministic triage score for the human reviewer.
// ---------------------------------------------------------------------------

export interface PedagogicalValue {
  /** 0..1 — 0 = pure noise, ≥ MIN_PEDAGOGICAL_VALUE = worth a human read. */
  score: number;
  factors: {
    substance: number;
    resolution: number;
    testability: number;
    generalizability: number;
    stanceDivergence: number;
  };
}

/** Below this, a CLI-council divergence is journal noise, not a lesson. */
export const MIN_PEDAGOGICAL_VALUE = 0.35;

const FALSIFIABLE_MARKERS =
  /would change my mind|réfut|refut|falsif|suggested fix|fix:|vérifi|verifi|\bsi\b[^.]{0,80}\b(alors|sinon)\b|\bif\b[^.]{0,80}\bthen\b|\bunless\b|\btant que\b/i;
const NORMATIVE_MARKERS =
  /\b(toujours|jamais|should|always|never|must|préf[ée]r\w*|prefer\w*|éviter|eviter|avoid|require\w*|exiger?)\b/i;
/** Case-bound tokens: paths, hex ids, long numbers, versions — contingency signals. */
const CONTINGENT_TOKENS = /(?:[\w.-]*[/\\][\w.-]+)|\b[0-9a-f]{8,}\b|\b\d{4,}\b|\bv?\d+\.\d+(?:\.\d+)?\b/gi;

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

function tokenSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? []);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface PedagogicalValueInput {
  verdictKind: 'judged' | 'abstained';
  positions: CouncilPosition[];
  resolution?: CouncilResolution;
}

/**
 * Rate how much a divergence is worth to a human reviewer. Pure and
 * deterministic (no LLM): the score must be auditable and reproducible.
 *
 * Criteria (from the transcript-corpus analysis):
 *  - substance        — the candidate carries actual opposing positions,
 *                       not just who diverged;
 *  - resolution       — a divergence SETTLED by a neutral judge (rationale,
 *                       self-verified facts) teaches more than an open one;
 *  - testability      — falsifiable content (WOULD CHANGE MY MIND, suggested
 *                       fixes, si/alors conditions) makes the lesson checkable;
 *  - generalizability — normative, principle-level language generalizes;
 *                       paths/ids/version numbers bind it to one case;
 *  - stanceDivergence — the positions must actually contradict (different
 *                       polarity or genuinely different content).
 * Hard gate: an ABSTAINED verdict is infrastructure noise (dead judge,
 * timeout) — score 0, never a lesson.
 */
export function scorePedagogicalValue(input: PedagogicalValueInput): PedagogicalValue {
  const zero: PedagogicalValue['factors'] = {
    substance: 0,
    resolution: 0,
    testability: 0,
    generalizability: 0,
    stanceDivergence: 0,
  };
  if (input.verdictKind === 'abstained') {
    return { score: 0, factors: zero };
  }

  const stances = input.positions.map((p) => p.stance.trim()).filter((s) => s.length > 0);
  const meaty = stances.filter((s) => s.length >= 20);
  const substance = clamp01(meaty.length / 2);

  const resolution = input.resolution?.rationale
    ? clamp01(0.7 + (input.resolution.verified ? 0.3 : 0))
    : 0;

  const testableBits = [...stances, input.resolution?.rationale ?? '', input.resolution?.verified ?? ''].filter(
    (s) => FALSIFIABLE_MARKERS.test(s),
  );
  const testability = clamp01(testableBits.length / 2);

  const allText = stances.join(' ');
  const tokens = allText.match(/\S+/g)?.length ?? 0;
  const contingent = allText.match(CONTINGENT_TOKENS)?.length ?? 0;
  const contingencyRatio = tokens === 0 ? 1 : clamp01(contingent / Math.max(4, tokens / 4));
  const normativeBoost = NORMATIVE_MARKERS.test(allText) ? 0.2 : 0;
  const generalizability = clamp01(1 - contingencyRatio + normativeBoost);

  let stanceDivergence = 0;
  if (meaty.length >= 2) {
    const sets = meaty.map((s) => tokenSet(s));
    let minSim = 1;
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        minSim = Math.min(minSim, jaccard(sets[i]!, sets[j]!));
      }
    }
    stanceDivergence = clamp01(1 - minSim);
  }

  const factors = { substance, resolution, testability, generalizability, stanceDivergence };
  const score = clamp01(
    0.25 * substance + 0.2 * resolution + 0.2 * testability + 0.2 * generalizability + 0.15 * stanceDivergence,
  );
  return { score, factors };
}

// ---------------------------------------------------------------------------
// Content — the candidate must be readable WITHOUT reopening the transcript.
// ---------------------------------------------------------------------------

const MAX_CONTENT_CHARS = 900;

function trimTo(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function buildRichContent(
  goal: string,
  positions: CouncilPosition[],
  resolution: CouncilResolution | undefined,
  consensus: CouncilConsensusInput,
): string {
  const parts: string[] = [
    `Fleet Council on "${trimTo(goal, 110)}" (agreement ${Math.round(consensus.score * 100)}%, ${consensus.total} voices).`,
  ];
  const shown = positions.filter((p) => p.stance.trim()).slice(0, 3);
  if (shown.length > 0) {
    parts.push('Positions: ' + shown.map((p) => `«${p.label}» ${trimTo(p.stance, 180)}`).join(' ⇄ ') + '.');
  }
  if (resolution?.rationale) {
    parts.push(
      `Settled${resolution.winner ? ` for «${resolution.winner}»` : ''}: ${trimTo(resolution.rationale, 200)}` +
        (resolution.verified ? ` [judge verified: ${trimTo(resolution.verified, 120)}]` : '') +
        '.',
    );
  } else {
    parts.push('Unsettled — an open question, not a resolved rule: validate before relying on either side.');
  }
  return trimTo(parts.join(' '), MAX_CONTENT_CHARS);
}

// ---------------------------------------------------------------------------
// Saga path (Cowork SagaRunner) — real peers answering the SAME prompt, so a
// lexical divergence is already meaningful. Gates unchanged; content and
// provenance enriched (previews become positions, score attached for triage —
// informational, not gating, to keep the saga behavior stable).
// ---------------------------------------------------------------------------

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

  const positions: CouncilPosition[] = disagreements
    .filter((d) => d.preview?.trim())
    .map((d) => ({ label: `${d.peerId}×${d.model}`, stance: d.preview! }));
  return proposeCandidate(input, workDir, positions, undefined, { gateOnValue: false });
}

// ---------------------------------------------------------------------------
// CLI-council path — value-gated.
// ---------------------------------------------------------------------------

export interface CouncilRunLessonInput {
  task: string;
  planMode: 'direct' | 'collective';
  confidence: 'high' | 'medium' | 'low';
  verdictKind: 'judged' | 'abstained';
  consensus: CouncilConsensusInput;
  /** Members' positions (VERDICT lines / first lines) — the lesson's substance. */
  positions?: CouncilPosition[];
  /** How the judge settled it, when it did. */
  resolution?: CouncilResolution;
}

export function proposeFromCouncilRunResult(
  input: CouncilRunLessonInput,
  workDir: string,
): ProposeFromCouncilResult {
  // Infra noise is NEVER a lesson: an abstained verdict (dead judge, timeout)
  // says nothing about the CONTENT — replaying real transcripts showed these
  // were the majority of proposals. The scoreboard's failure ledger already
  // captures that signal on the right channel.
  if (input.verdictKind === 'abstained') {
    return { proposed: false, reason: 'judge abstained — infrastructure noise, not knowledge' };
  }

  const disagreements = input.consensus?.disagreements ?? [];
  const lexicalDisagreement =
    disagreements.length > 0 ||
    (typeof input.consensus?.score === 'number' &&
      typeof input.consensus?.threshold === 'number' &&
      input.consensus.score < input.consensus.threshold);
  if (!lexicalDisagreement) {
    return { proposed: false, reason: 'full agreement — nothing to learn' };
  }

  // Positions: prefer the members' explicit stances; fall back to the
  // disagreement previews when the caller has nothing richer.
  const positions: CouncilPosition[] =
    input.positions?.filter((p) => p.stance.trim()).slice(0, 4) ??
    [];
  if (positions.length === 0) {
    for (const d of disagreements) {
      if (d.preview?.trim()) positions.push({ label: `${d.peerId}×${d.model}`, stance: d.preview });
    }
  }

  // Value gate: a divergence must be worth a human read — substance,
  // resolution, testability, generalizability. Fixes both failure modes seen
  // on real data: metadata-only noise proposed, resolved substantive
  // disagreements skipped.
  const value = scorePedagogicalValue({
    verdictKind: input.verdictKind,
    positions,
    ...(input.resolution ? { resolution: input.resolution } : {}),
  });
  if (value.score < MIN_PEDAGOGICAL_VALUE) {
    return {
      proposed: false,
      reason: `pedagogical value ${value.score.toFixed(2)} below ${MIN_PEDAGOGICAL_VALUE} — journal noise, not a lesson`,
    };
  }

  // Stable per-question id: re-running the same task must hit the saga-level
  // dedup instead of piling up near-duplicate candidates.
  const sagaId = `cli:${createHash('sha256').update(input.task.trim().toLowerCase()).digest('hex').slice(0, 16)}`;

  return proposeCandidate(
    { sagaId, goal: input.task, aggregation: 'consensus', consensus: input.consensus },
    workDir,
    positions,
    input.resolution,
    { gateOnValue: true, value },
  );
}

// ---------------------------------------------------------------------------
// Shared propose (dedup + queue + provenance with the triage score).
// ---------------------------------------------------------------------------

function proposeCandidate(
  input: CouncilOutcomeInput,
  workDir: string,
  positions: CouncilPosition[],
  resolution: CouncilResolution | undefined,
  opts: { gateOnValue: boolean; value?: PedagogicalValue },
): ProposeFromCouncilResult {
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

  // Saga-level dedup: one pending candidate per saga/question.
  try {
    const existing = queue.list('pending').find((c) => c.provenance?.sagaId === input.sagaId);
    if (existing) {
      return { proposed: false, reason: 'already proposed for this saga', candidate: existing };
    }
  } catch {
    // Non-fatal — fall through and let propose() de-dup on content.
  }

  const value =
    opts.value ??
    scorePedagogicalValue({ verdictKind: 'judged', positions, ...(resolution ? { resolution } : {}) });

  try {
    const { candidate } = queue.propose({
      // A settled, verified disagreement is closer to a rule; an open one is an insight to validate.
      category: resolution?.rationale ? 'RULE' : 'INSIGHT',
      content: buildRichContent(input.goal, positions, resolution, input.consensus),
      context: `Fleet council · saga ${input.sagaId} · value ${value.score.toFixed(2)}`,
      source: 'self_observed',
      provenance: {
        sagaId: input.sagaId,
        note: 'auto-proposed from council divergence',
        pedagogicalValue: value.score,
        valueFactors: value.factors,
      },
    });
    return { proposed: true, candidate };
  } catch (err) {
    logger.warn('[council-lesson] propose failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { proposed: false, reason: 'propose failed' };
  }
}
