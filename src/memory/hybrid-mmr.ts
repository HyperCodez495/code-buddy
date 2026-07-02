/**
 * Hybrid retrieval core — BM25 + embeddings fused by Reciprocal Rank Fusion,
 * reranked with MMR (Maximal Marginal Relevance). Pure and deterministic:
 * callers supply the scores/vectors, this module only ranks.
 *
 * WHY RRF and not a weighted sum: BM25 scores are unbounded and
 * corpus-dependent, cosine similarities live in [-1, 1] with a
 * model-dependent distribution — a linear mix of the two is an arbitrary
 * calibration that silently shifts whenever the corpus or the embedding
 * model changes. RRF (Cormack, Clarke & Buettcher 2009) fuses RANKS:
 * `score(d) = Σ_leg w_leg / (K + rank_leg(d))` — scale-free, robust, no
 * per-corpus tuning, and it degrades gracefully when one leg is missing
 * (a doc unranked by a leg simply contributes nothing for that leg).
 * `semanticWeight` weighs the legs (weighted-RRF variant), K=60 is the
 * literature default (flattens the head so one leg cannot dictate alone).
 *
 * WHY MMR (Carbonell & Goldstein 1998): naive top-k maximizes relevance
 * only, so near-duplicate passages crowd the result and — in an auditable
 * context injection — waste the token budget AND bias the agent by
 * majority-through-duplication. MMR selects greedily
 * `argmax λ·rel(d) − (1−λ)·max_sim(d, selected)`: λ=1 is pure relevance
 * (== naive top-k), λ=0 is pure diversity; λ≈0.7 keeps the head relevant
 * while forcing coverage of distinct facts.
 *
 * @module memory/hybrid-mmr
 */

export interface HybridCandidate {
  id: string;
  /** BM25 (or any lexical) raw score — only its RANK is used. */
  lexicalScore: number;
  /** Cosine similarity to the query — only its RANK is used for fusion; the
   * VECTOR drives the MMR diversity term. */
  semanticScore: number | null;
  vector: Float32Array | null;
  /** Multiplicative domain prior (salience, corroboration…), default 1.
   * Applied AFTER fusion: rank fusion normalises heterogeneous scorers,
   * domain priors then scale comparable numbers. */
  prior?: number;
}

export interface HybridMmrOptions {
  /** How many results to select. */
  k: number;
  /** MMR balance: 1 = pure relevance (naive top-k), 0 = pure diversity. */
  lambda?: number;
  /** Weight of the semantic leg in the weighted RRF (0..1). */
  semanticWeight?: number;
  /** RRF smoothing constant (literature default 60). */
  rrfK?: number;
}

export interface RankedCandidate {
  id: string;
  /** Weighted-RRF fusion × prior — the relevance the MMR loop consumed. */
  relevance: number;
  lexicalRank: number | null;
  semanticRank: number | null;
}

const DEFAULT_LAMBDA = 0.7;
const DEFAULT_SEMANTIC_WEIGHT = 0.7;
const DEFAULT_RRF_K = 60;

export function cosineSimilarityF32(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** 1-based ranks for the ids, ordered by score desc; null/absent scores are unranked. */
function ranksByScore(entries: Array<{ id: string; score: number | null }>): Map<string, number> {
  const ranked = entries
    .filter((e): e is { id: string; score: number } => e.score !== null && Number.isFinite(e.score))
    .sort((a, b) => b.score - a.score);
  const ranks = new Map<string, number>();
  ranked.forEach((e, i) => ranks.set(e.id, i + 1));
  return ranks;
}

/**
 * Weighted Reciprocal Rank Fusion over the two legs, then domain priors.
 * Returns candidates sorted by fused relevance (no diversity yet).
 */
export function fuseHybrid(
  candidates: HybridCandidate[],
  opts: Pick<HybridMmrOptions, 'semanticWeight' | 'rrfK'> = {},
): RankedCandidate[] {
  const wSem = clamp01(opts.semanticWeight ?? DEFAULT_SEMANTIC_WEIGHT);
  const rrfK = opts.rrfK ?? DEFAULT_RRF_K;

  const lexRanks = ranksByScore(
    candidates.map((c) => ({ id: c.id, score: c.lexicalScore > 0 ? c.lexicalScore : null })),
  );
  const semRanks = ranksByScore(candidates.map((c) => ({ id: c.id, score: c.semanticScore })));

  return candidates
    .map((c) => {
      const lexicalRank = lexRanks.get(c.id) ?? null;
      const semanticRank = semRanks.get(c.id) ?? null;
      const rrf =
        (semanticRank !== null ? wSem / (rrfK + semanticRank) : 0) +
        (lexicalRank !== null ? (1 - wSem) / (rrfK + lexicalRank) : 0);
      return {
        id: c.id,
        relevance: rrf * (c.prior ?? 1),
        lexicalRank,
        semanticRank,
      };
    })
    .sort((a, b) => b.relevance - a.relevance);
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

/**
 * MMR greedy selection over fused candidates. Diversity similarity uses the
 * candidate VECTORS (cosine); candidates without a vector fall back to a
 * zero similarity (they can only be crowded out by relevance, never by
 * diversity — honest degradation when embeddings are unavailable).
 */
export function mmrSelect(
  fused: RankedCandidate[],
  vectors: Map<string, Float32Array | null>,
  opts: Pick<HybridMmrOptions, 'k' | 'lambda'>,
): RankedCandidate[] {
  const lambda = clamp01(opts.lambda ?? DEFAULT_LAMBDA);
  const k = Math.max(1, opts.k);
  if (fused.length === 0) return [];

  // Normalise relevance to [0,1] so λ trades off against a comparable
  // diversity term (cosine is already ≤ 1).
  const maxRel = fused[0]!.relevance || 1;
  const pool = fused.map((c) => ({ ...c, rel: maxRel === 0 ? 0 : c.relevance / maxRel }));

  const selected: typeof pool = [];
  const remaining = [...pool];
  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i]!;
      const v = vectors.get(cand.id) ?? null;
      let maxSim = 0;
      if (v) {
        for (const s of selected) {
          const sv = vectors.get(s.id) ?? null;
          if (sv) maxSim = Math.max(maxSim, cosineSimilarityF32(v, sv));
        }
      }
      const mmr = lambda * cand.rel - (1 - lambda) * maxSim;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }
    selected.push(remaining.splice(bestIdx, 1)[0]!);
  }
  return selected.map(({ id, relevance, lexicalRank, semanticRank }) => ({ id, relevance, lexicalRank, semanticRank }));
}

/** Fusion + MMR in one call — the shape recallHybrid consumes. */
export function hybridMmrRank(candidates: HybridCandidate[], opts: HybridMmrOptions): RankedCandidate[] {
  const fused = fuseHybrid(candidates, opts);
  const vectors = new Map(candidates.map((c) => [c.id, c.vector]));
  return mmrSelect(fused, vectors, opts);
}
