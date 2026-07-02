/**
 * The reranker's lexical tokenizers used ASCII `\w`/`\W`, so accented French
 * words were split into fragments. With the length>2 filter this usually
 * cancels out, EXCEPT when two DIFFERENT accented words share a >2-char tail
 * fragment: "opérateur" and "générateur" both reduced to {"rateur"} under the
 * old split, making calculateSimilarity report 1.0 (identical) — so the
 * diversity dedup wrongly dropped one as redundant. The Unicode-aware split
 * keeps whole words.
 */
import { describe, it, expect } from 'vitest';
import { CrossEncoderReranker } from '../../src/context/cross-encoder-reranker.js';

type SimFn = { calculateSimilarity(a: string, b: string): number };
function sim(r: CrossEncoderReranker, a: string, b: string): number {
  return (r as unknown as SimFn).calculateSimilarity(a, b);
}

describe('cross-encoder reranker lexical similarity — Unicode safety', () => {
  const r = new CrossEncoderReranker();

  it('does NOT treat two distinct accented words as identical', () => {
    // Old ASCII split reduced both to {"rateur"} → similarity 1.0.
    expect(sim(r, 'opérateur', 'générateur')).toBeLessThan(0.5);
  });

  it('still reports identical content as fully similar', () => {
    expect(sim(r, 'déployer le serveur en production', 'déployer le serveur en production')).toBe(1);
  });

  it('reports partial overlap for docs sharing an accented word', () => {
    const s = sim(r, 'déployer une application', 'déployer un serveur');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});
