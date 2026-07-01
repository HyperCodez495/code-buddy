/**
 * Council decision signals + synthesis prompt building.
 *
 * The confidence signal combines the judge margin with the lexical
 * (Jaccard) agreement — EXCEPT in collective (role-specialised) runs, where
 * answers legitimately diverge lexically by design: an Architect and a
 * Reviewer answering the same task SHOULD not use the same words. Counting
 * lexical divergence against confidence there systematically suppressed
 * learning in exactly the runs the conductor mode was built for.
 *
 * @module council/signals
 */

import type {
  CouncilDecisionSignals,
  CouncilSynthesisCandidate,
  CouncilSynthesisPrompt,
} from './types.js';

function clampScore(score: number): number {
  return Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
}

export interface DecisionSignalContext {
  /** Collective runs: ignore the lexical-consensus term (see module docstring). */
  collective?: boolean;
}

export function computeCouncilDecisionSignals(
  scores: number[],
  winnerIdx: number | null,
  consensusScore: number,
  ctx: DecisionSignalContext = {},
): CouncilDecisionSignals {
  const consensus = clampScore(consensusScore);

  if (winnerIdx === null) {
    return {
      confidence: 'low',
      winnerScore: 0,
      runnerUpScore: Math.max(0, ...scores.map(clampScore)),
      margin: 0,
      consensusScore: consensus,
      reasons: ['judge abstained'],
    };
  }

  const normalized = scores.map(clampScore);
  const winnerScore = clampScore(normalized[winnerIdx] ?? Math.max(0, ...normalized));
  const runnerUpScore = Math.max(0, ...normalized.filter((_, index) => index !== winnerIdx));
  const margin = Math.max(0, winnerScore - runnerUpScore);
  const useConsensus = !ctx.collective;
  const reasons: string[] = [];

  if (winnerScore < 0.55) reasons.push('weak winner score');
  if (margin < 0.15 && normalized.length > 1) reasons.push('narrow judge margin');
  if (useConsensus && consensus < 0.35 && normalized.length > 1) reasons.push('low answer agreement');

  let confidence: CouncilDecisionSignals['confidence'] = 'high';
  if (winnerScore < 0.55 || margin < 0.15 || (useConsensus && consensus < 0.25)) {
    confidence = 'low';
  } else if (winnerScore < 0.72 || margin < 0.3 || (useConsensus && consensus < 0.45)) {
    confidence = 'medium';
  }

  if (reasons.length === 0) {
    reasons.push(confidence === 'high' ? 'clear judge margin and sufficient agreement' : 'moderate judge margin or agreement');
  }
  return {
    confidence,
    winnerScore,
    runnerUpScore,
    margin,
    consensusScore: consensus,
    reasons,
  };
}

export function buildCouncilVerificationHint(signals: CouncilDecisionSignals, taskType: string): string | undefined {
  if (signals.confidence === 'high') return undefined;
  const base = signals.confidence === 'low'
    ? 'Vérification recommandée'
    : 'Vérification utile';
  if (taskType === 'code') {
    return `${base}: demander un plan de tests ciblé au Verifier ou relancer avec --fleet pour un avis machine distinct.`;
  }
  if (taskType === 'vision') {
    return `${base}: vérifier avec une autre image ou un autre angle avant d'agir.`;
  }
  return `${base}: relancer avec --fleet ou augmenter -n si la décision a un impact important.`;
}

/**
 * Learn only from reliable judge signals: a parsed verdict from a NEUTRAL
 * judge, on a run whose confidence isn't low. Abstentions and panel-member
 * judges still produce a useful answer, but must not train future routing.
 */
export function shouldRecordCouncilLearning(
  verdictLearnable: boolean,
  confidence: CouncilDecisionSignals['confidence'],
): boolean {
  return verdictLearnable && confidence !== 'low';
}

function truncateForSynthesis(text: string, maxChars = 4500): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trim()}\n...[truncated for council synthesis]`;
}

function buildDissentNotes(
  candidates: CouncilSynthesisCandidate[],
  consensusScore?: number,
  signals?: CouncilDecisionSignals,
): string[] {
  const notes: string[] = [];
  if (typeof consensusScore === 'number' && consensusScore < 0.35 && candidates.length > 1) {
    notes.push('Low lexical agreement: preserve useful minority objections instead of flattening them.');
  }
  if (signals?.confidence === 'low') {
    notes.push('Low decision confidence: state what is solid, what remains uncertain, and what should be verified next.');
  }

  const scores = candidates.map((candidate) => candidate.score).filter((score) => Number.isFinite(score));
  if (scores.length > 1) {
    const spread = Math.max(...scores) - Math.min(...scores);
    if (spread >= 0.45) {
      notes.push('Large judge-score spread: treat weak candidates as dissent or risk signals, not equal votes.');
    }
  }

  const roleLabels = new Set(candidates.map((candidate) => candidate.roleLabel).filter(Boolean));
  if (roleLabels.size > 1) {
    notes.push('Role-specialized inputs: merge complementary strengths and call out unresolved conflicts.');
  }
  return notes;
}

export function buildCouncilSynthesisPrompt(
  task: string,
  candidates: CouncilSynthesisCandidate[],
  consensusScore?: number,
  signals?: CouncilDecisionSignals,
): CouncilSynthesisPrompt {
  const blocks = candidates
    .map((candidate, index) => {
      const letter = String.fromCharCode(65 + index);
      const role = candidate.roleLabel ? ` / role: ${candidate.roleLabel}` : '';
      const winner = candidate.winner ? ' / judge reference winner' : '';
      return [
        `### Candidate ${letter}${role}${winner} / score ${candidate.score.toFixed(2)}`,
        truncateForSynthesis(candidate.content),
      ].join('\n');
    })
    .join('\n\n');

  const consensus =
    typeof consensusScore === 'number'
      ? `\nLexical agreement signal: ${Math.round(consensusScore * 100)}%. Treat this as a weak signal only.`
      : '';
  const confidence = signals
    ? `\nDecision confidence: ${signals.confidence} (winner ${signals.winnerScore.toFixed(2)}, runner-up ${signals.runnerUpScore.toFixed(2)}, margin ${signals.margin.toFixed(2)}). Reasons: ${signals.reasons.join('; ')}.`
    : '';
  const dissentNotes = buildDissentNotes(candidates, consensusScore, signals);
  const dissent =
    dissentNotes.length > 0
      ? `\nDissent handling:\n${dissentNotes.map((note) => `- ${note}`).join('\n')}`
      : '';

  // Anchor guard: measured on real transcripts, the synthesis retained 2.6×
  // more of the winner's distinctive content than the dissenter's, and
  // silently converted the critic's open questions into "assumptions". The
  // imposed structure makes flattening visible and citation of the weakest
  // candidate mandatory when the judge spread is large.
  const judgeScores = candidates.map((c) => c.score).filter((s) => Number.isFinite(s));
  const spread = judgeScores.length > 1 ? Math.max(...judgeScores) - Math.min(...judgeScores) : 0;
  const mustCiteMinority = spread > 0.3 && candidates.length > 1;

  return {
    system:
      'You are Code Buddy Council synthesizer. You do NOT majority-vote and you do NOT rewrite the winning ' +
      'answer: you arbitrate divergent positions. MANDATORY structure:\n' +
      '1. DECISION — the final recommendation, one sentence.\n' +
      '2. FRICTION POINTS — each real disagreement between members, attributed (role X says A, role Y says B), ' +
      'which side you keep, and WHY.\n' +
      '3. RETAINED MINORITY OPINION — ' +
      (mustCiteMinority
        ? 'quote verbatim at least ONE objection from the lowest-scored member; if you reject it, refute it explicitly (ignoring it is forbidden).\n'
        : 'state the strongest objection raised by a non-winning member, or "none raised".\n') +
      '4. REVERSAL CONDITIONS — the concrete conditions under which the decision becomes wrong (reuse the ' +
      'members\' "WOULD CHANGE MY MIND" statements).\n' +
      '5. UNRESOLVED QUESTIONS — the questions members asked that this synthesis does NOT answer ' +
      '(never convert them into silent assumptions).\n' +
      'Do not average weak points. Keep the best concrete recommendations and answer in the language of the task.',
    user: `Original user task:\n${task}\n${consensus}${confidence}${dissent}\n\nCouncil answers:\n${blocks}\n\nWrite the synthesized arbitration now, following the mandatory structure.`,
  };
}
