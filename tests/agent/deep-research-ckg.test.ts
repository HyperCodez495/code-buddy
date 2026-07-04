/**
 * Deep Research — Phase D (Collective Knowledge Graph bridge) unit tests.
 *
 * The single side-effecting edge — the CKG — is an INJECTED fake `CkgBridge`, so
 * every test runs with ZERO ledger / ZERO network. Covers:
 *  - recall (read): bounded top-K, empty query, never-throws
 *  - ingest (write): fingerprint/url dedup + excerpt-bound, never-throws
 *  - report augmentation: recalled memory injected as a DISTINCT "## Mémoire
 *    collective" section with a [Mk] citation namespace, before "## Références"
 *  - the wrapper: OFF ⇒ base run VERBATIM (recall/ingest never called, identical
 *    result — byte-identical proof); ON ⇒ recall (start) + ingest (end) + augment
 *  - graceful degradation: recall/ingest throwing ⇒ the run continues, never throws
 *  - combinable: loop-shaped (Phase B) and storm-shaped (Phase C) results survive
 *    the wrapper unchanged apart from the augmented report + attached `ckg`
 *  - tee + env-gate helpers
 */
import { describe, it, expect, vi } from 'vitest';

import {
  recallCollectiveMemory,
  ingestCollectedSources,
  prepareIngestBatch,
  augmentReportWithMemory,
  runDeepResearchWithCkg,
  teeScrapeBoundary,
  resolveCkgEnabled,
  type CkgBridge,
  type CkgMemorySource,
  type CkgIngestableSource,
} from '../../src/agent/deep-research-ckg.js';
import type { DeepResearchResult } from '../../src/agent/deep-research.js';

// --------------------------------------------------------------------------
// Fakes
// --------------------------------------------------------------------------

function memHit(text: string, extra: Partial<CkgMemorySource> = {}): CkgMemorySource {
  return { id: `id:${text}`, text, ...extra };
}

interface FakeBridgeCfg {
  recall?: (q: string, k: number) => Promise<CkgMemorySource[]>;
  ingest?: (s: CkgIngestableSource[], meta: unknown) => Promise<number>;
}

function fakeBridge(cfg: FakeBridgeCfg = {}): CkgBridge {
  return {
    recall: vi.fn(cfg.recall ?? (async () => [])),
    ingest: vi.fn(cfg.ingest ?? (async (s: CkgIngestableSource[]) => s.length)),
  };
}

function baseResult(over: Partial<DeepResearchResult> = {}): DeepResearchResult {
  return {
    question: 'Q',
    plan: { question: 'Q', subQuestions: [{ subQuestion: 'SQ', queries: ['q1'] }] },
    sources: [
      { id: 1, url: 'https://a.com', title: 'Alpha' },
      { id: 2, url: 'https://b.com', title: 'Beta' },
    ],
    report: '## TL;DR\n\nBody [1][2].\n\n## Références\n\n[1] Alpha — https://a.com\n[2] Beta — https://b.com',
    durationMs: 10,
    plannerLlmUsed: true,
    synthesisLlmUsed: true,
    duplicatesDropped: 0,
    ...over,
  };
}

// ==========================================================================
// 1. Recall (read)
// ==========================================================================

describe('recallCollectiveMemory', () => {
  it('returns up to top-K non-empty hits, hard-capped by the limit', async () => {
    const bridge = fakeBridge({
      recall: async (_q, k) => Array.from({ length: 10 }, (_, i) => memHit(`m${i}`)).slice(0, k),
    });
    const out = await recallCollectiveMemory(bridge, 'question', 3);
    expect(out).toHaveLength(3);
    expect(bridge.recall).toHaveBeenCalledWith('question', 3);
  });

  it('empty/whitespace query ⇒ [] and the bridge is not touched', async () => {
    const bridge = fakeBridge();
    expect(await recallCollectiveMemory(bridge, '   ', 5)).toEqual([]);
    expect(bridge.recall).not.toHaveBeenCalled();
  });

  it('drops entries with empty text', async () => {
    const bridge = fakeBridge({ recall: async () => [memHit('good'), { id: 'x', text: '   ' }] });
    const out = await recallCollectiveMemory(bridge, 'q', 5);
    expect(out.map((m) => m.text)).toEqual(['good']);
  });

  it('never throws — a bridge failure degrades to []', async () => {
    const bridge = fakeBridge({ recall: async () => { throw new Error('ledger unreadable'); } });
    await expect(recallCollectiveMemory(bridge, 'q', 5)).resolves.toEqual([]);
  });

  it('clamps the limit into [1, 20]', async () => {
    const bridge = fakeBridge();
    await recallCollectiveMemory(bridge, 'q', 999);
    expect(bridge.recall).toHaveBeenCalledWith('q', 20);
    await recallCollectiveMemory(bridge, 'q', 0);
    expect(bridge.recall).toHaveBeenLastCalledWith('q', 1);
  });
});

// ==========================================================================
// 2. Ingest (write)
// ==========================================================================

describe('prepareIngestBatch', () => {
  it('drops empty content and duplicate urls, truncates the excerpt', () => {
    const batch = prepareIngestBatch(
      [
        { url: 'https://a.com', title: 'A', content: 'x'.repeat(1000) },
        { url: 'https://a.com', title: 'A dup url', content: 'different content entirely here' },
        { url: 'https://b.com', title: 'B', content: '   ' },
      ],
      100,
    );
    expect(batch).toHaveLength(1);
    expect(batch[0]!.url).toBe('https://a.com');
    expect(batch[0]!.content).toHaveLength(100);
  });

  it('drops a near-duplicate content under a different url (reuses Phase-A fingerprint)', () => {
    const body =
      'The quick brown fox jumps over the lazy dog near the river bank every morning at dawn while the birds sing in the tall green trees above the sleepy village square';
    const batch = prepareIngestBatch(
      [
        { url: 'https://one.com', title: 'One', content: body },
        { url: 'https://two.com', title: 'Two', content: `${body} and then it rested calmly.` },
        { url: 'https://three.com', title: 'Three', content: 'A completely unrelated superconducting qubit topic entirely' },
      ],
      4000,
    );
    expect(batch.map((b) => b.url)).toEqual(['https://one.com', 'https://three.com']);
  });
});

describe('ingestCollectedSources', () => {
  it('ingests the deduped batch and returns a bounded count', async () => {
    const seen: CkgIngestableSource[][] = [];
    const bridge = fakeBridge({ ingest: async (s) => { seen.push(s); return s.length; } });
    const n = await ingestCollectedSources(
      bridge,
      [
        { url: 'https://a.com', title: 'A', content: 'alpha content here' },
        { url: 'https://b.com', title: 'B', content: 'beta content here' },
      ],
      { question: 'Q', source: 'deep-research' },
    );
    expect(n).toBe(2);
    expect(seen[0]!.map((s) => s.url)).toEqual(['https://a.com', 'https://b.com']);
    expect(bridge.ingest).toHaveBeenCalledWith(expect.any(Array), { question: 'Q', source: 'deep-research' });
  });

  it('empty batch ⇒ 0, bridge not touched', async () => {
    const bridge = fakeBridge();
    expect(await ingestCollectedSources(bridge, [], { question: 'Q', source: 'x' })).toBe(0);
    expect(bridge.ingest).not.toHaveBeenCalled();
  });

  it('never throws — a bridge failure degrades to 0', async () => {
    const bridge = fakeBridge({ ingest: async () => { throw new Error('append failed'); } });
    await expect(
      ingestCollectedSources(bridge, [{ url: 'https://a.com', title: 'A', content: 'c' }], { question: 'Q', source: 'x' }),
    ).resolves.toBe(0);
  });

  it('caps the returned count to the batch size even if the bridge over-reports', async () => {
    const bridge = fakeBridge({ ingest: async () => 999 });
    const n = await ingestCollectedSources(bridge, [{ url: 'https://a.com', title: 'A', content: 'c' }], {
      question: 'Q',
      source: 'x',
    });
    expect(n).toBe(1);
  });
});

// ==========================================================================
// 3. Report augmentation
// ==========================================================================

describe('augmentReportWithMemory', () => {
  const report = '## TL;DR\n\nBody [1].\n\n## Références\n\n[1] Alpha — https://a.com';

  it('empty memory ⇒ the report is returned untouched', () => {
    expect(augmentReportWithMemory(report, [])).toBe(report);
  });

  it('injects a DISTINCT "## Mémoire collective" section with [Mk] markers before "## Références"', () => {
    const out = augmentReportWithMemory(report, [
      memHit('LM Studio resizes context via a Rust sidecar', { agentId: 'host/repo', source: 'deep-research', similarity: 0.72 }),
      memHit('RRF rank fusion beats a linear mix'),
    ]);
    expect(out).toContain('## Mémoire collective');
    expect(out).toContain('[M1] LM Studio resizes context via a Rust sidecar — par host/repo, source deep-research (sim 0.72)');
    expect(out).toContain('[M2] RRF rank fusion beats a linear mix');
    // memory section sits BEFORE the web references, which stay last
    expect(out.indexOf('## Mémoire collective')).toBeLessThan(out.indexOf('## Références'));
    // web citations are a separate namespace — untouched
    expect(out).toContain('[1] Alpha — https://a.com');
    // exactly one references block
    expect(out.match(/## Références/g)).toHaveLength(1);
  });

  it('appends the section when the report has no "## Références" heading', () => {
    const out = augmentReportWithMemory('Just a body, no refs.', [memHit('prior fact')]);
    expect(out).toContain('Just a body, no refs.');
    expect(out.trimEnd().endsWith('[M1] prior fact')).toBe(true);
  });
});

// ==========================================================================
// 4. The wrapper — OFF (byte-identical) vs ON
// ==========================================================================

describe('runDeepResearchWithCkg — OFF (byte-identical guarantee)', () => {
  it('enabled:false ⇒ base run VERBATIM: recall/ingest NEVER called, identical result', async () => {
    const bridge = fakeBridge();
    const base = baseResult();
    const runBase = vi.fn(async () => base);
    const collect = vi.fn(() => [{ url: 'https://a.com', title: 'A', content: 'c' }]);

    const out = await runDeepResearchWithCkg({
      question: 'Q',
      options: { enabled: false, bridge },
      runBase,
      collectSourcesForIngest: collect,
    });

    expect(out).toBe(base); // same reference — report + sources strictly identical
    expect((out as { ckg?: unknown }).ckg).toBeUndefined();
    expect(bridge.recall).not.toHaveBeenCalled();
    expect(bridge.ingest).not.toHaveBeenCalled();
    expect(collect).not.toHaveBeenCalled();
  });

  it('bridge absent (even if enabled) ⇒ base run VERBATIM', async () => {
    const base = baseResult();
    const out = await runDeepResearchWithCkg({
      question: 'Q',
      options: { enabled: true },
      runBase: async () => base,
      collectSourcesForIngest: () => [],
    });
    expect(out).toBe(base);
    expect((out as { ckg?: unknown }).ckg).toBeUndefined();
  });
});

describe('runDeepResearchWithCkg — ON', () => {
  it('recalls at the start, ingests the collected sources at the end, augments the report', async () => {
    const order: string[] = [];
    const bridge: CkgBridge = {
      recall: vi.fn(async () => { order.push('recall'); return [memHit('prior knowledge about Q', { agentId: 'peer/x' })]; }),
      ingest: vi.fn(async (s: CkgIngestableSource[]) => { order.push('ingest'); return s.length; }),
    };
    const base = baseResult();
    const runBase = vi.fn(async () => { order.push('run'); return base; });

    const out = await runDeepResearchWithCkg({
      question: 'Q',
      options: { enabled: true, bridge },
      runBase,
      collectSourcesForIngest: (r) =>
        r.sources.map((s) => ({ url: s.url, title: s.title, content: `content of ${s.url}` })),
    });

    // recall BEFORE the base run; ingest AFTER it.
    expect(order).toEqual(['recall', 'run', 'ingest']);
    // recall queried on the question.
    expect(bridge.recall).toHaveBeenCalledWith('Q', 6);
    // ingest received the two deduped web sources + provenance meta.
    const ingestArg = (bridge.ingest as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((ingestArg[0] as CkgIngestableSource[]).map((s) => s.url)).toEqual(['https://a.com', 'https://b.com']);
    expect(ingestArg[1]).toMatchObject({ question: 'Q', source: 'deep-research' });
    // report augmented with the recalled memory, cited distinctly.
    expect(out.report).toContain('## Mémoire collective');
    expect(out.report).toContain('[M1] prior knowledge about Q — par peer/x');
    // the web sources + flags are preserved untouched; only the report changed.
    expect(out.sources).toBe(base.sources);
    expect(out.plannerLlmUsed).toBe(true);
    // outcome surfaced for the CLI.
    expect(out.ckg).toMatchObject({ enabled: true, recalled: 1, ingested: 2 });
  });

  it('a recall failure does NOT stop ingest or the run (never throws)', async () => {
    const bridge: CkgBridge = {
      recall: vi.fn(async () => { throw new Error('recall down'); }),
      ingest: vi.fn(async (s: CkgIngestableSource[]) => s.length),
    };
    const out = await runDeepResearchWithCkg({
      question: 'Q',
      options: { enabled: true, bridge },
      runBase: async () => baseResult(),
      collectSourcesForIngest: () => [{ url: 'https://a.com', title: 'A', content: 'c' }],
    });
    expect(out.ckg).toMatchObject({ enabled: true, recalled: 0, ingested: 1 });
    expect(out.report).not.toContain('## Mémoire collective'); // nothing recalled
  });

  it('an ingest failure does NOT corrupt the run (never throws, still augments)', async () => {
    const bridge: CkgBridge = {
      recall: vi.fn(async () => [memHit('prior')]),
      ingest: vi.fn(async () => { throw new Error('ingest down'); }),
    };
    const out = await runDeepResearchWithCkg({
      question: 'Q',
      options: { enabled: true, bridge },
      runBase: async () => baseResult(),
      collectSourcesForIngest: () => [{ url: 'https://a.com', title: 'A', content: 'c' }],
    });
    expect(out.ckg).toMatchObject({ enabled: true, recalled: 1, ingested: 0 });
    expect(out.report).toContain('## Mémoire collective');
  });

  it('combinable with Phase B (loop-shaped result): rounds/roundInfos survive intact', async () => {
    const bridge = fakeBridge({ recall: async () => [memHit('prior')] });
    const loopResult = {
      ...baseResult(),
      rounds: 2,
      converged: true,
      roundInfos: [{ round: 1, gapQueries: [], newSources: 2, duplicatesDropped: 0 }],
    };
    const out = await runDeepResearchWithCkg({
      question: 'Q',
      options: { enabled: true, bridge },
      runBase: async () => loopResult,
      collectSourcesForIngest: (r) => r.sources.map((s) => ({ url: s.url, title: s.title, content: 'c' })),
    });
    expect(out.rounds).toBe(2);
    expect(out.converged).toBe(true);
    expect(out.roundInfos).toHaveLength(1);
    expect(out.report).toContain('## Mémoire collective');
  });

  it('combinable with Phase C (storm-shaped result): perspectives/outline survive intact', async () => {
    const bridge = fakeBridge({ recall: async () => [memHit('prior')] });
    const stormResult = {
      ...baseResult(),
      perspectives: [{ perspective: { id: 'p', label: 'P', angle: 'a', focus: [] }, sourceCount: 1, subQuestions: 1, failed: false, plannerLlmUsed: true }],
      outline: { title: 'T', sections: [{ title: 'S' }] },
      outlineLlmUsed: true,
      coWritten: true,
    };
    const out = await runDeepResearchWithCkg({
      question: 'Q',
      options: { enabled: true, bridge },
      runBase: async () => stormResult,
      collectSourcesForIngest: (r) => r.sources.map((s) => ({ url: s.url, title: s.title, content: 'c' })),
    });
    expect(out.coWritten).toBe(true);
    expect(out.outline.sections).toHaveLength(1);
    expect(out.perspectives).toHaveLength(1);
    expect(out.report).toContain('## Mémoire collective');
  });
});

// ==========================================================================
// 5. Tee + env-gate helpers
// ==========================================================================

describe('teeScrapeBoundary', () => {
  it('tees non-empty scraped content into the sink, preserves other boundaries', async () => {
    const sink = new Map<string, string>();
    const llm = async () => 'llm';
    const boundaries = {
      llm,
      search: async () => [],
      scrape: async (url: string) => (url === 'https://a.com' ? 'A content' : '   '),
    };
    const teed = teeScrapeBoundary(boundaries, sink);
    expect(await teed.scrape('https://a.com')).toBe('A content');
    expect(await teed.scrape('https://empty.com')).toBe('   ');
    expect(sink.get('https://a.com')).toBe('A content');
    expect(sink.has('https://empty.com')).toBe(false); // empty content not recorded
    expect(teed.llm).toBe(llm); // other boundaries preserved
  });
});

describe('resolveCkgEnabled', () => {
  it('the --ckg flag enables it', () => {
    expect(resolveCkgEnabled({ ckg: true }, {})).toBe(true);
  });
  it('CODEBUDDY_COLLECTIVE_MEMORY=true enables it (shared gate)', () => {
    expect(resolveCkgEnabled({}, { CODEBUDDY_COLLECTIVE_MEMORY: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });
  it('off by default; a non-"true" env value does not enable it', () => {
    expect(resolveCkgEnabled({}, {})).toBe(false);
    expect(resolveCkgEnabled({ ckg: false }, { CODEBUDDY_COLLECTIVE_MEMORY: '1' } as NodeJS.ProcessEnv)).toBe(false);
  });
});
