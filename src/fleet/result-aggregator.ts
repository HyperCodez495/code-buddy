/**
 * Fleet — Result aggregator (Fleet P4).
 *
 * After all parallel dispatch lanes of a saga complete, this module
 * synthesises the N answers into a single final result via a small
 * extra LLM call. The aggregator prompt is configurable per saga;
 * the default below works for most "ask the same question to N
 * models, give me the best synthesis" workflows.
 *
 * When a saga has no parallel lanes (just primary + optional
 * fallback), the aggregator is a no-op — `finaliseFromSingle()`
 * just copies the primary lane's result to `finalResult`.
 *
 * @module fleet/result-aggregator
 */

import type { CodeBuddyClient } from '../codebuddy/client.js';
import { logger } from '../utils/logger.js';
import type { SagaRecord, SagaStep } from './saga-store.js';

const DEFAULT_AGGREGATOR_PROMPT = `Voici plusieurs réponses indépendantes au même prompt utilisateur, chacune produite par un modèle différent.

Synthétise une réponse finale en :
1. Identifiant les points de consensus (où ≥2 modèles s'accordent)
2. Notant les désaccords majeurs avec le pourquoi
3. Produisant une réponse unique cohérente, factuelle, prête pour l'utilisateur final

Ne mentionne pas l'existence des sources individuelles dans la réponse finale ; rends juste le résultat utile.`;

/**
 * Closure that returns the LLM client to use for the aggregator
 * call. Same pattern as `peer-chat-bridge.ts:PeerChatClientGetter`.
 */
export type AggregatorClientGetter = () => CodeBuddyClient | null;

let cachedGetter: AggregatorClientGetter | null = null;

/**
 * Wire the aggregator's LLM client. Called once from server boot.
 * The client is captured lazily via `getter()` so callers can swap
 * it without re-wiring.
 */
export function wireAggregatorClient(getter: AggregatorClientGetter): void {
  cachedGetter = getter;
}

/** Test-only reset. */
export function _unwireAggregatorClient(): void {
  cachedGetter = null;
}

/**
 * Synthesise a final answer from completed parallel steps. Returns
 * the final string. Throws when:
 *   - no client is wired
 *   - fewer than 1 step has a usable result
 *
 * The caller (saga executor) is expected to write the result back
 * via `SagaStore.finalise()`.
 */
export async function aggregateParallelResults(
  saga: SagaRecord,
  options: { systemPrompt?: string } = {},
): Promise<string> {
  const completed = saga.steps.filter(
    (s) => s.status === 'completed' && typeof s.result === 'string',
  );
  if (completed.length === 0) {
    throw new Error(
      'aggregateParallelResults: no completed steps with a result',
    );
  }
  if (completed.length === 1) {
    // Nothing to synthesise — just return the single answer.
    const only = completed[0];
    if (only === undefined || typeof only.result !== 'string') {
      throw new Error(
        'aggregateParallelResults: no completed steps with a result',
      );
    }
    return only.result;
  }

  const client = cachedGetter?.() ?? null;
  if (!client) {
    // Graceful fallback: concatenate with separators so the saga
    // doesn't dead-end. The user gets raw content rather than a fail.
    logger.warn?.('[result-aggregator] no client wired, falling back to concat');
    return concatenateAsFallback(completed);
  }

  const userPrompt = buildUserPrompt(saga, completed);
  const systemPrompt = options.systemPrompt ?? DEFAULT_AGGREGATOR_PROMPT;

  try {
    const response = await client.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      [], // no tools
    );
    const text = response?.choices?.[0]?.message?.content ?? '';
    if (!text) {
      logger.warn?.('[result-aggregator] LLM returned empty content, falling back');
      return concatenateAsFallback(completed);
    }
    return text;
  } catch (err) {
    logger.warn?.('[result-aggregator] LLM call failed, falling back', {
      err: err instanceof Error ? err.message : String(err),
    });
    return concatenateAsFallback(completed);
  }
}

/**
 * Council prompt (Fleet collaboration). Unlike the plain aggregator,
 * this asks the model to act as an arbiter: surface where peers agree,
 * critique divergent positions, reconcile into one answer, and report a
 * confidence level reflecting how much the peers actually agreed.
 */
const CONSENSUS_AGGREGATOR_PROMPT = `Plusieurs pairs ont répondu indépendamment à la même question. Agis comme arbitre du conseil :
1. Identifie les points où les réponses convergent (consensus).
2. Repère les désaccords et critique brièvement les positions divergentes (laquelle est la mieux étayée, et pourquoi).
3. Réconcilie le tout en UNE réponse finale cohérente, factuelle, prête pour l'utilisateur final.
4. Termine par une ligne « Confiance : <faible|moyenne|élevée> » reflétant le degré d'accord entre les pairs.

N'expose pas les labels de source (peer×model) dans la réponse finale ; rends juste le résultat utile.`;

/**
 * A single source's contribution to a council, identified by the peer
 * and model that produced it.
 */
export interface ConsensusSource {
  peerId: string;
  model: string;
  text: string;
}

/**
 * Deterministic measure of how much the council members agreed. The
 * score is the mean pairwise Jaccard word-overlap similarity across all
 * sources (0 = no overlap, 1 = identical); `perSource[i].agreement` is
 * source i's mean similarity to every other source. This is lifted from
 * `ParallelExecutor.checkConsensus()` (same simple word-set heuristic),
 * standalone so the fleet path doesn't drag in the ParallelExecutor
 * class + its config/EventEmitter machinery.
 */
export interface ConsensusSummary {
  /** Mean pairwise similarity, 0..1. */
  score: number;
  /** Whether `score >= threshold`. */
  reached: boolean;
  /** The threshold used to decide `reached`. */
  threshold: number;
  /** How many sources individually agree with the group (agreement ≥ threshold). */
  agreeingCount: number;
  /** Total number of sources scored. */
  total: number;
  perSource: Array<{ peerId: string; model: string; agreement: number }>;
  /** Sources whose agreement fell below the threshold, with a short preview. */
  disagreements: Array<{ peerId: string; model: string; preview: string }>;
}

/** Default agreement threshold — mirrors `DEFAULT_PARALLEL_CONFIG.consensusThreshold`. */
const DEFAULT_CONSENSUS_THRESHOLD = 0.7;

/**
 * Jaccard similarity over lowercased word sets. Lifted verbatim (in
 * spirit) from `parallel-executor.ts:calculateSimilarity()`. Two empty
 * texts are treated as fully similar; one empty / one non-empty is 0.
 */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  const union = new Set([...wordsA, ...wordsB]);
  if (union.size === 0) return 0;
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  return intersection.size / union.size;
}

/**
 * Compute a {@link ConsensusSummary} from labelled council sources.
 * Pure + synchronous so it's trivially unit-testable. With 0 sources the
 * summary is empty (not reached); with 1 source it's vacuously full
 * agreement (score 1, reached) since there's nothing to disagree with.
 */
export function computeTextConsensus(
  sources: ConsensusSource[],
  threshold: number = DEFAULT_CONSENSUS_THRESHOLD,
): ConsensusSummary {
  const total = sources.length;
  if (total === 0) {
    return {
      score: 0,
      reached: false,
      threshold,
      agreeingCount: 0,
      total: 0,
      perSource: [],
      disagreements: [],
    };
  }
  if (total === 1) {
    const only = sources[0]!;
    return {
      score: 1,
      reached: true,
      threshold,
      agreeingCount: 1,
      total: 1,
      perSource: [{ peerId: only.peerId, model: only.model, agreement: 1 }],
      disagreements: [],
    };
  }

  // Per-source mean similarity to every other source.
  const perSource = sources.map((src, i) => {
    let sum = 0;
    for (let j = 0; j < total; j++) {
      if (j === i) continue;
      sum += jaccardSimilarity(src.text, sources[j]!.text);
    }
    const agreement = sum / (total - 1);
    return { peerId: src.peerId, model: src.model, agreement };
  });

  // Overall score = mean of per-source agreements (== mean pairwise sim).
  const score = perSource.reduce((acc, p) => acc + p.agreement, 0) / total;
  const agreeingCount = perSource.filter((p) => p.agreement >= threshold).length;
  const disagreements = sources
    .filter((_, i) => perSource[i]!.agreement < threshold)
    .map((src) => ({
      peerId: src.peerId,
      model: src.model,
      preview: src.text.slice(0, 140),
    }));

  return {
    score,
    reached: score >= threshold,
    threshold,
    agreeingCount,
    total,
    perSource,
    disagreements,
  };
}

/**
 * Council aggregation (Fleet collaboration). Synthesises a final answer
 * from N completed parallel steps **and** returns a deterministic
 * {@link ConsensusSummary} so callers (e.g. the Cowork SagaRunner) can
 * persist/visualise how much the peers agreed.
 *
 * Unlike {@link aggregateParallelResults} it always returns the
 * consensus metadata, and its prompt asks the model to critique
 * divergent positions rather than blandly merge them. Same graceful
 * fallbacks: when no client is wired or the LLM fails/empties, the final
 * text falls back to a labelled concatenation (consensus is still
 * computed and returned).
 *
 * Throws only when there is not a single completed step with a result.
 */
export async function aggregateWithConsensus(
  saga: SagaRecord,
  options: { systemPrompt?: string; threshold?: number } = {},
): Promise<{ finalText: string; consensus: ConsensusSummary }> {
  const completed = saga.steps.filter(
    (s) => s.status === 'completed' && typeof s.result === 'string',
  );
  if (completed.length === 0) {
    throw new Error(
      'aggregateWithConsensus: no completed steps with a result',
    );
  }

  const sources: ConsensusSource[] = completed.map((s) => ({
    peerId: s.peerId,
    model: s.model,
    text: s.result!,
  }));
  const consensus = computeTextConsensus(
    sources,
    options.threshold ?? DEFAULT_CONSENSUS_THRESHOLD,
  );

  if (completed.length === 1) {
    return { finalText: completed[0]!.result!, consensus };
  }

  const client = cachedGetter?.() ?? null;
  if (!client) {
    logger.warn?.('[result-aggregator] no client wired (consensus), falling back to concat');
    return { finalText: concatenateAsFallback(completed), consensus };
  }

  const userPrompt = buildConsensusUserPrompt(saga, completed, consensus);
  const systemPrompt = options.systemPrompt ?? CONSENSUS_AGGREGATOR_PROMPT;

  try {
    const response = await client.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      [], // no tools
    );
    const text = response?.choices?.[0]?.message?.content ?? '';
    if (!text) {
      logger.warn?.('[result-aggregator] consensus LLM returned empty content, falling back');
      return { finalText: concatenateAsFallback(completed), consensus };
    }
    return { finalText: text, consensus };
  } catch (err) {
    logger.warn?.('[result-aggregator] consensus LLM call failed, falling back', {
      err: err instanceof Error ? err.message : String(err),
    });
    return { finalText: concatenateAsFallback(completed), consensus };
  }
}

/**
 * For non-parallel sagas (primary + optional fallback), no synthesis
 * is needed — just return the primary lane's result. Returns null
 * when neither lane succeeded.
 */
export function finaliseFromSingle(saga: SagaRecord): string | null {
  const primary = saga.steps.find((s) => s.lane === 'primary');
  if (primary?.status === 'completed' && primary.result) {
    return primary.result;
  }
  const fallback = saga.steps.find((s) => s.lane === 'fallback');
  if (fallback?.status === 'completed' && fallback.result) {
    return fallback.result;
  }
  return null;
}

/**
 * Build the user-side prompt for the aggregator from the saga's
 * goal + the N parallel results. Each source is labelled `peer×model`
 * so the LLM can spot disagreements per-source if it wants — the
 * default system prompt asks it not to expose those labels in the
 * output, but they're useful debugging context for the LLM.
 */
function buildUserPrompt(
  saga: SagaRecord,
  completed: SagaStep[],
): string {
  const lines: string[] = [
    `Goal de l'utilisateur :\n${saga.goal}\n`,
    `\n${completed.length} réponses indépendantes :\n`,
  ];
  for (const [i, step] of completed.entries()) {
    lines.push(
      `\n--- Source ${i + 1} (${step.peerId} × ${step.model}) ---\n${step.result}\n`,
    );
  }
  return lines.join('');
}

/**
 * Council variant of {@link buildUserPrompt}: prepends the measured
 * agreement level so the arbiter LLM knows up front whether it's
 * reconciling near-identical answers or genuinely divergent ones.
 */
function buildConsensusUserPrompt(
  saga: SagaRecord,
  completed: SagaStep[],
  consensus: ConsensusSummary,
): string {
  const pct = Math.round(consensus.score * 100);
  const thresholdPct = Math.round(consensus.threshold * 100);
  const lines: string[] = [
    `Goal de l'utilisateur :\n${saga.goal}\n`,
    `\nNiveau de consensus mesuré : ${pct}% (seuil ${thresholdPct}%, ${consensus.reached ? 'atteint' : 'non atteint'}).\n`,
    `\n${completed.length} réponses indépendantes :\n`,
  ];
  for (const [i, step] of completed.entries()) {
    lines.push(
      `\n--- Source ${i + 1} (${step.peerId} × ${step.model}) ---\n${step.result}\n`,
    );
  }
  return lines.join('');
}

function concatenateAsFallback(steps: SagaStep[]): string {
  return steps
    .map((s, i) => `Source ${i + 1} (${s.peerId} × ${s.model}):\n${s.result}\n`)
    .join('\n---\n');
}
