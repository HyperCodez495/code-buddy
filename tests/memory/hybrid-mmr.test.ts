/**
 * Hybrid RRF fusion + MMR rerank — pure, deterministic, crafted vectors.
 *
 * The centerpiece: PROOF that MMR reduces redundancy vs naive top-k — a
 * cluster of near-duplicate passages crowds a λ=1 selection (mean pairwise
 * cosine ≈ 1) while λ=0.7 covers distinct clusters at the same k.
 */
import { describe, expect, it } from 'vitest';
import {
  cosineSimilarityF32,
  fuseHybrid,
  hybridMmrRank,
  mmrSelect,
  type HybridCandidate,
} from '../../src/memory/hybrid-mmr.js';

function vec(...xs: number[]): Float32Array {
  return Float32Array.from(xs);
}

function candidate(over: Partial<HybridCandidate> & { id: string }): HybridCandidate {
  return { lexicalScore: 0, semanticScore: null, vector: null, ...over };
}

/** Mean pairwise cosine of the selected ids — the redundancy metric. */
function meanPairwiseSim(ids: string[], vectors: Map<string, Float32Array>): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      sum += cosineSimilarityF32(vectors.get(ids[i]!)!, vectors.get(ids[j]!)!);
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

describe('fuseHybrid — weighted Reciprocal Rank Fusion', () => {
  it('a doc ranked well by BOTH legs beats a single-leg champion', () => {
    const fused = fuseHybrid(
      [
        candidate({ id: 'both', lexicalScore: 8, semanticScore: 0.8 }), // rank 2 lex, rank 2 sem
        candidate({ id: 'lex-only', lexicalScore: 10, semanticScore: null }), // rank 1 lex
        candidate({ id: 'sem-only', lexicalScore: 0, semanticScore: 0.9 }), // rank 1 sem
      ],
      { semanticWeight: 0.5 },
    );
    expect(fused[0]!.id).toBe('both');
  });

  it('is scale-invariant: multiplying one leg\'s raw scores changes NOTHING (ranks fuse, not scores)', () => {
    const docs = [
      candidate({ id: 'a', lexicalScore: 3, semanticScore: 0.2 }),
      candidate({ id: 'b', lexicalScore: 2, semanticScore: 0.9 }),
      candidate({ id: 'c', lexicalScore: 1, semanticScore: 0.5 }),
    ];
    const scaled = docs.map((d) => ({ ...d, lexicalScore: d.lexicalScore * 1000 }));

    expect(fuseHybrid(docs).map((f) => f.id)).toEqual(fuseHybrid(scaled).map((f) => f.id));
  });

  it('degrades gracefully when a leg is missing (semantic down → lexical ranking)', () => {
    const fused = fuseHybrid([
      candidate({ id: 'low', lexicalScore: 1 }),
      candidate({ id: 'high', lexicalScore: 9 }),
      candidate({ id: 'mid', lexicalScore: 5 }),
    ]);
    expect(fused.map((f) => f.id)).toEqual(['high', 'mid', 'low']);
  });

  it('applies domain priors multiplicatively AFTER fusion', () => {
    const [first] = fuseHybrid([
      candidate({ id: 'plain', lexicalScore: 9, semanticScore: 0.9 }),
      candidate({ id: 'corroborated', lexicalScore: 8, semanticScore: 0.8, prior: 3 }),
    ]);
    expect(first!.id).toBe('corroborated');
  });
});

describe('mmrSelect — MMR reduces redundancy vs naive top-k (the proof)', () => {
  // Cluster A: three near-duplicate passages (same fact, reworded).
  // Cluster B and C: distinct facts, slightly less relevant.
  const vectors = new Map<string, Float32Array>([
    ['a1', vec(1, 0.01, 0)],
    ['a2', vec(0.99, 0.03, 0)],
    ['a3', vec(0.98, 0.02, 0.01)],
    ['b1', vec(0, 1, 0)],
    ['c1', vec(0, 0, 1)],
  ]);
  const candidates: HybridCandidate[] = [
    candidate({ id: 'a1', lexicalScore: 10, semanticScore: 0.99, vector: vectors.get('a1')! }),
    candidate({ id: 'a2', lexicalScore: 9, semanticScore: 0.98, vector: vectors.get('a2')! }),
    candidate({ id: 'a3', lexicalScore: 8, semanticScore: 0.97, vector: vectors.get('a3')! }),
    candidate({ id: 'b1', lexicalScore: 7, semanticScore: 0.5, vector: vectors.get('b1')! }),
    candidate({ id: 'c1', lexicalScore: 6, semanticScore: 0.4, vector: vectors.get('c1')! }),
  ];

  it('λ=1 (naive top-k) fills the selection with near-duplicates', () => {
    const ids = hybridMmrRank(candidates, { k: 3, lambda: 1 }).map((r) => r.id);
    expect(ids).toEqual(['a1', 'a2', 'a3']);
    expect(meanPairwiseSim(ids, vectors)).toBeGreaterThan(0.95); // redundant
  });

  it('λ=0.7 keeps the most relevant duplicate and covers the OTHER clusters at the same k', () => {
    const ids = hybridMmrRank(candidates, { k: 3, lambda: 0.7 }).map((r) => r.id);
    expect(ids).toContain('a1'); // relevance head preserved
    expect(ids).toContain('b1');
    expect(ids).toContain('c1');
    expect(meanPairwiseSim(ids, vectors)).toBeLessThan(0.1); // diverse
  });

  it('redundancy decreases monotonically as λ decreases', () => {
    const simAt = (lambda: number): number =>
      meanPairwiseSim(hybridMmrRank(candidates, { k: 3, lambda }).map((r) => r.id), vectors);
    expect(simAt(0.3)).toBeLessThanOrEqual(simAt(0.7));
    expect(simAt(0.7)).toBeLessThanOrEqual(simAt(1));
  });

  it('candidates without vectors are never crowded out by the diversity term', () => {
    const fused = fuseHybrid([
      candidate({ id: 'v', lexicalScore: 9, vector: vec(1, 0, 0) }),
      candidate({ id: 'no-vec', lexicalScore: 8 }),
    ]);
    const picked = mmrSelect(fused, new Map([['v', vec(1, 0, 0)], ['no-vec', null]]), { k: 2, lambda: 0.5 });
    expect(picked.map((p) => p.id).sort()).toEqual(['no-vec', 'v']);
  });

  it('k larger than the pool returns everything once', () => {
    const ranked = hybridMmrRank(candidates, { k: 10, lambda: 0.7 });
    expect(ranked).toHaveLength(5);
    expect(new Set(ranked.map((r) => r.id)).size).toBe(5);
  });
});
