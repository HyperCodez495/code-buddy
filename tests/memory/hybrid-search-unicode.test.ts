/**
 * The memory BM25 tokenizer stripped punctuation with `[^\w\s]`; `\w` is
 * ASCII-only, so accented French words were split into low-signal fragments
 * ("déployer" → "d"+"ployer", "déféquer" → "d"+"f"+"quer"). Beyond diluting the
 * index, this created spurious matches: a query "déployer" matched ANY doc
 * sharing the "d" fragment. Code Buddy is used in French, so this degraded
 * memory recall precision. The Unicode-aware tokenizer keeps whole words.
 */
import { describe, it, expect } from 'vitest';
import { BM25Index } from '../../src/memory/hybrid-search.js';

describe('memory BM25 tokenizer — Unicode safety', () => {
  it('an accented query matches only the relevant doc, not a fragment decoy', () => {
    const idx = new BM25Index();
    idx.addDocument('target', 'déployer le serveur en production');
    idx.addDocument('decoy', 'déféquer les données du rapport'); // shares only the "d" fragment under the old tokenizer

    const keys = idx.search('déployer', 10).map((r) => r.key);
    expect(keys).toContain('target');
    // Under the old ASCII tokenizer the decoy scored via the shared "d" fragment.
    expect(keys).not.toContain('decoy');
  });

  it('ranks the doc containing the intact accented term first', () => {
    const idx = new BM25Index();
    idx.addDocument('fr', 'La qualité du café est évaluée chaque matin');
    idx.addDocument('en', 'The quality of the tea is measured every evening');

    const results = idx.search('qualité café', 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.key).toBe('fr');
  });
});
