import { extractSalientTerms, normalizeConversationText } from './dialogue-act.js';
import { planConversationResponse } from './discourse-planner.js';
import type { ConversationTurn } from './types.js';

export type ConversationResponseIssue =
  | 'empty'
  | 'too_shallow'
  | 'unstructured'
  | 'unrelated'
  | 'repetitive'
  | 'circular_reasoning'
  | 'connector_stuffing';

export interface ConversationQualityAssessment {
  score: number;
  passes: boolean;
  sentenceCount: number;
  reasoningLinkCount: number;
  relevantTermCount: number;
  /** Number of substantive clauses, never their text. */
  propositionCount: number;
  /** Clauses remaining after near-duplicate propositions are collapsed. */
  uniquePropositionCount: number;
  propositionNoveltyRate: number;
  circularityRate: number;
  /** Reasoning connectors per normalized response token. */
  connectorDensity: number;
  /** Ordered coverage of position → objection → concession → synthesis. */
  deliberationProgressionScore: number;
  issues: ConversationResponseIssue[];
}

/** Numeric-only comparison of two assistant turns; safe for aggregate journals. */
export interface ConversationTurnProgression {
  score: number;
  propositionNoveltyRate: number;
  contentNoveltyRate: number;
  comparedPropositionCount: number;
  stalled: boolean;
}

const REASONING_LINKS =
  /\b(parce que|puisque|car|donc|ainsi|cependant|pourtant|toutefois|neanmoins|mais|or|en revanche|au contraire|autrement dit|par exemple|meme si|bien que|certes|en consequence|c est pourquoi|cela dit|d un cote|de l autre|en somme|en synthese|en definitive)\b/g;

const PROPOSITION_STOP_WORDS = new Set([
  'afin', 'ainsi', 'alors', 'apres', 'au', 'aux', 'avec', 'avoir', 'bien', 'car', 'ce',
  'cela', 'ces', 'cet', 'cette', 'comme', 'dans', 'de', 'des', 'donc', 'du', 'elle',
  'elles', 'en', 'encore', 'est', 'et', 'etre', 'eux', 'il', 'ils', 'je', 'la', 'le',
  'les', 'leur', 'leurs', 'lui', 'mais', 'meme', 'mes', 'mon', 'ne', 'nos', 'notre',
  'nous', 'on', 'ou', 'par', 'parce', 'pas', 'plus', 'pour', 'pourtant', 'puis', 'que',
  'qui', 'sa', 'sans', 'se', 'ses', 'si', 'son', 'sont', 'sur', 'tandis', 'te', 'tes',
  'toi', 'ton', 'toutefois', 'tu', 'un', 'une', 'vos', 'votre', 'vous', 'y',
  // Discourse labels should not make two otherwise identical claims look novel.
  'certes', 'cependant', 'concede', 'concedons', 'conclusion', 'definitive', 'exemple',
  'finalement', 'revanche', 'somme', 'synthese',
]);

type DeliberationMove = 'position' | 'objection' | 'concession' | 'synthesis' | 'other';

interface Proposition {
  tokens: Set<string>;
  move: DeliberationMove;
}

interface PropositionAnalysis {
  propositions: Proposition[];
  duplicateCount: number;
  uniqueCount: number;
  noveltyRate: number;
  circularityRate: number;
  progressionScore: number;
  substantiveTokenCount: number;
}

const OBJECTION =
  /\b(cependant|pourtant|toutefois|neanmoins|en revanche|au contraire|objection|limite|mais)\b/;
const CONCESSION =
  /\b(meme si|bien que|certes|je concede|nous concedons|je reconnais|il est vrai|j accorde)\b/;
const SYNTHESIS =
  /\b(en somme|en synthese|en definitive|au bout du compte|ma conclusion|je conclus|je dirais alors|je parlerais alors|la meilleure position|finalement)\b/;
const POSITION =
  /\b(ma position|je pense|je soutiens|je dirais|a mon sens|selon moi|j estime|mon point de vue)\b/;
const NEGATION = /\b(?:ne|n)\b(?:\s+\p{L}+){0,4}\s+\b(?:pas|jamais|plus)\b|\bsans\b/u;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function canonicalToken(token: string): string {
  if (/^(important|importance|importe|compte|valeur|essentiel)/.test(token)) return 'valeur';
  if (/^(prouve|preuve|demontr|etablit|etablir)/.test(token)) return 'preuve';
  if (/^(authentique|authenticite|reel|reelle|realite)/.test(token)) return 'authentique';
  const singular = token.length > 5 ? token.replace(/[sx]$/u, '') : token;
  // A conservative prefix stem joins conscience/conscient and relation/relationnel
  // without depending on a language model or storing the source proposition.
  return singular.length > 8 ? singular.slice(0, 8) : singular;
}

function propositionTokens(text: string): Set<string> {
  const normalized = normalizeConversationText(text).replace(/\?/g, '');
  const tokens = normalized
    .split(' ')
    .filter((token) => token.length >= 3 && !PROPOSITION_STOP_WORDS.has(token))
    .map(canonicalToken);
  if (NEGATION.test(normalized)) tokens.push('__negation');
  return new Set(tokens);
}

function deliberationMove(text: string, index: number): DeliberationMove {
  const normalized = normalizeConversationText(text);
  // Concession can contain an objection word ("même si ... mais ..."), so it wins.
  if (CONCESSION.test(normalized)) return 'concession';
  if (SYNTHESIS.test(normalized)) return 'synthesis';
  if (OBJECTION.test(normalized)) return 'objection';
  if (index === 0 || POSITION.test(normalized)) return 'position';
  return 'other';
}

function propositionClauses(text: string): string[] {
  const result: string[] = [];
  for (const sentence of sentences(text)) {
    // Semicolons are genuine proposition boundaries. A comma before a high-level
    // contrast/concession/synthesis marker is also safe to split; causal clauses stay attached.
    const clauses = sentence.split(
      /[;:]+|,\s*(?=(?:cependant|pourtant|toutefois|néanmoins|neanmoins|en revanche|au contraire|même si|meme si|certes|en somme|en synthèse|en synthese|en définitive|en definitive)\b)/iu
    );
    for (const clause of clauses) {
      const clean = clause.replace(/\s+/g, ' ').trim();
      if (clean) result.push(clean);
    }
  }
  return result;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) if (b.has(token)) count += 1;
  return count;
}

function propositionSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  // Reversing a proposition is a substantive revision, not a paraphrase.
  if (a.has('__negation') !== b.has('__negation')) return 0;
  const shared = overlap(a, b);
  if (shared < 2) return 0;
  const containment = shared / Math.min(a.size, b.size);
  const union = a.size + b.size - shared;
  const jaccard = union > 0 ? shared / union : 0;
  return clamp(containment * 0.65 + jaccard * 0.35);
}

function orderedProgressionScore(propositions: Proposition[]): number {
  const expected: DeliberationMove[] = ['position', 'objection', 'concession', 'synthesis'];
  let cursor = 0;
  for (let index = 0; index < propositions.length && cursor < expected.length; index++) {
    const move = propositions[index]!.move;
    // The first substantive proposition is an implicit position unless labelled otherwise.
    if (cursor === 0 && index === 0) {
      cursor += 1;
      if (move === expected[cursor]) cursor += 1;
      continue;
    }
    if (move === expected[cursor]) cursor += 1;
  }
  return cursor / expected.length;
}

function isNearDuplicate(candidate: Proposition, previous: Proposition): boolean {
  return propositionSimilarity(candidate.tokens, previous.tokens) >= 0.78;
}

function analyzePropositions(text: string): PropositionAnalysis {
  const propositions = propositionClauses(text)
    .map((clause, index): Proposition => ({
      tokens: propositionTokens(clause),
      move: deliberationMove(clause, index),
    }))
    .filter((proposition) => proposition.tokens.size > 0);
  const unique: Proposition[] = [];
  let duplicateCount = 0;
  for (const proposition of propositions) {
    const previous = unique.find((candidate) => isNearDuplicate(proposition, candidate));
    if (previous) duplicateCount += 1;
    else unique.push(proposition);
  }
  const count = propositions.length;
  return {
    propositions,
    duplicateCount,
    uniqueCount: unique.length,
    noveltyRate: count > 0 ? unique.length / count : 0,
    circularityRate: count > 0 ? duplicateCount / count : 0,
    progressionScore: orderedProgressionScore(propositions),
    substantiveTokenCount: propositions.reduce(
      (total, proposition) => total + proposition.tokens.size,
      0
    ),
  };
}

/** Compare consecutive assistant turns without returning or retaining either text. */
export function measureConversationTurnProgression(
  previousResponse: string,
  currentResponse: string
): ConversationTurnProgression {
  const previous = analyzePropositions(previousResponse);
  const current = analyzePropositions(currentResponse);
  if (current.propositions.length === 0) {
    return {
      score: 0,
      propositionNoveltyRate: 0,
      contentNoveltyRate: 0,
      comparedPropositionCount: 0,
      stalled: true,
    };
  }
  if (previous.propositions.length === 0) {
    return {
      score: 1,
      propositionNoveltyRate: 1,
      contentNoveltyRate: 1,
      comparedPropositionCount: current.propositions.length,
      stalled: false,
    };
  }

  const novelPropositions = current.propositions.filter(
    (proposition) =>
      !previous.propositions.some((candidate) => isNearDuplicate(proposition, candidate))
  ).length;
  const propositionNoveltyRate = novelPropositions / current.propositions.length;
  const previousTokens = new Set(
    previous.propositions.flatMap((proposition) => [...proposition.tokens])
  );
  const currentTokens = new Set(
    current.propositions.flatMap((proposition) => [...proposition.tokens])
  );
  const novelTokens = [...currentTokens].filter((token) => !previousTokens.has(token)).length;
  const contentNoveltyRate = currentTokens.size > 0 ? novelTokens / currentTokens.size : 0;
  const score = clamp(propositionNoveltyRate * 0.7 + contentNoveltyRate * 0.3);
  return {
    score,
    propositionNoveltyRate,
    contentNoveltyRate,
    comparedPropositionCount: current.propositions.length,
    stalled: score < 0.35,
  };
}

const SEMANTIC_TOPICS: RegExp[] = [
  /\b(ia|intelligence artificielle)\b/,
  /\b(aim\w*|amour)\b/,
  /\b(conscien\w*)\b/,
  /\b(libre arbitre|liberte)\b/,
  /\b(ethique|morale)\b/,
  /\b(actualite|nouvelles|news)\b/,
  /\b(humain\w*|relation\w*|proche\w*|ami\w*)\b/,
  /\b(epuise\w*|fatigue\w*|decourage\w*|lourd\w*|vide\w*|repos|effort\w*)\b/,
];

function sentences(text: string): string[] {
  const matches = text.match(/[^.!?…]+[.!?…]+(?:\s|$)|[^.!?…]+$/g) ?? [];
  return matches.map((sentence) => sentence.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export function assessConversationResponse(
  heard: string,
  response: string,
  history: ConversationTurn[] = []
): ConversationQualityAssessment {
  const clean = response.replace(/\s+/g, ' ').trim();
  const plan = planConversationResponse(heard, history);
  if (!clean) {
    return {
      score: 0,
      passes: false,
      sentenceCount: 0,
      reasoningLinkCount: 0,
      relevantTermCount: 0,
      propositionCount: 0,
      uniquePropositionCount: 0,
      propositionNoveltyRate: 0,
      circularityRate: 0,
      connectorDensity: 0,
      deliberationProgressionScore: 0,
      issues: ['empty'],
    };
  }

  const responseSentences = sentences(clean);
  const normalized = normalizeConversationText(clean);
  const normalizedHeard = normalizeConversationText(heard);
  const reasoningLinkCount = normalized.match(REASONING_LINKS)?.length ?? 0;
  const responseTokenCount = normalized.replace(/\?/g, '').split(' ').filter(Boolean).length;
  const connectorDensity = responseTokenCount > 0 ? reasoningLinkCount / responseTokenCount : 0;
  const propositions = analyzePropositions(clean);
  const salient = extractSalientTerms(heard, 8);
  const directRelevantTerms = salient.filter((term) => normalized.includes(term));
  const semanticTopicCount = SEMANTIC_TOPICS.filter(
    (topic) => topic.test(normalizedHeard) && topic.test(normalized)
  ).length;
  const relevantTermCount = directRelevantTerms.length + semanticTopicCount;
  const uniqueSentences = new Set(responseSentences.map(normalizeConversationText));
  const issues: ConversationQualityAssessment['issues'] = [];

  if (
    (plan.analysis.depth === 'developed' && responseSentences.length < 2) ||
    (plan.analysis.depth === 'deliberative' && responseSentences.length < 3)
  ) {
    issues.push('too_shallow');
  }
  if (plan.analysis.depth === 'deliberative' && reasoningLinkCount < 2) {
    issues.push('unstructured');
  }
  if (salient.length >= 2 && relevantTermCount === 0 && plan.analysis.act !== 'phatic') {
    issues.push('unrelated');
  }
  if (responseSentences.length >= 2 && uniqueSentences.size < responseSentences.length) {
    issues.push('repetitive');
  }
  // One concluding restatement is normal in a complete deliberation. Circularity means
  // repeated propositions dominate, or recur before a real objection/concession/synthesis arc.
  const circularReasoning =
    propositions.propositions.length >= 3 &&
    (propositions.duplicateCount >= 2 ||
      (propositions.duplicateCount >= 1 &&
        propositions.circularityRate >= 1 / 3 &&
        propositions.progressionScore < 0.75));
  if (circularReasoning) issues.push('circular_reasoning');

  const averageSubstantiveTokens =
    propositions.propositions.length > 0
      ? propositions.substantiveTokenCount / propositions.propositions.length
      : 0;
  const connectorToUniquePropositionRatio =
    reasoningLinkCount / Math.max(1, propositions.uniqueCount);
  const genuineDeliberation =
    propositions.progressionScore >= 0.75 && propositions.noveltyRate >= 0.75;
  const connectorStuffing =
    !genuineDeliberation &&
    reasoningLinkCount >= 3 &&
    (connectorDensity >= 0.11 ||
      connectorToUniquePropositionRatio >= 1.5 ||
      averageSubstantiveTokens < 2.5);
  if (connectorStuffing) issues.push('connector_stuffing');

  const score = Math.max(
    0,
    Math.min(
      1,
      1 -
        (issues.includes('too_shallow') ? 0.3 : 0) -
        (issues.includes('unstructured') ? 0.25 : 0) -
        (issues.includes('unrelated') ? 0.3 : 0) -
        (issues.includes('repetitive') ? 0.2 : 0) -
        (issues.includes('circular_reasoning') ? 0.3 : 0) -
        (issues.includes('connector_stuffing') ? 0.25 : 0)
    )
  );
  return {
    score,
    passes: issues.length === 0,
    sentenceCount: responseSentences.length,
    reasoningLinkCount,
    relevantTermCount,
    propositionCount: propositions.propositions.length,
    uniquePropositionCount: propositions.uniqueCount,
    propositionNoveltyRate: propositions.noveltyRate,
    circularityRate: propositions.circularityRate,
    connectorDensity,
    deliberationProgressionScore: propositions.progressionScore,
    issues,
  };
}
