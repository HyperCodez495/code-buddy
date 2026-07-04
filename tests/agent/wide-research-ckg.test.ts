/**
 * Deep Research — Phase D wiring through the REAL `WideResearchOrchestrator`.
 *
 * Mirrors `wide-research-deep.test.ts`: the LLM/search/scrape boundaries are
 * INJECTED fakes (5th arg) so nothing hits the network, and the CKG bridge is an
 * INJECTED spy (6th arg) so nothing touches a ledger. This proves the full
 * end-to-end plumbing that the pure `deep-research-ckg` tests cannot:
 *  - the scrape TEE captures per-source content, so `ingest` receives the deduped
 *    web sources WITH their scraped content
 *  - `recall` runs on the question and the recalled memory lands in the report
 *  - OFF (enabled:false) ⇒ recall/ingest never called AND the report is identical
 *    to a run with no CKG arg at all (byte-identical)
 *  - combinable with the Phase-B `--iterations` loop
 */
import { describe, it, expect, vi } from 'vitest';

import { WideResearchOrchestrator } from '../../src/agent/wide-research.js';
import type { DeepResearchBoundaries, SearchHit } from '../../src/agent/deep-research.js';
import type { CkgBridge, CkgIngestableSource, CkgMemorySource } from '../../src/agent/deep-research-ckg.js';

function hit(url: string, title = url): SearchHit {
  return { title, url, snippet: '' };
}

/** Fake LLM/search/scrape so a real Deep Research run needs zero network. */
function injectedBoundaries(): Partial<DeepResearchBoundaries> {
  return {
    llm: async (messages) => {
      const sys = messages.find((m) => m.role === 'system')?.content ?? '';
      if (sys.includes('research query planner')) {
        return JSON.stringify({ subQuestions: [{ subQuestion: 'What is it?', queries: ['q-alpha', 'q-beta'] }] });
      }
      // synthesis (and anything else) — a small cited body.
      return '## TL;DR\n\nBody citing [1][2].';
    },
    search: async (q: string, k: number) => {
      const map: Record<string, SearchHit[]> = {
        'q-alpha': [hit('https://a.com', 'Alpha')],
        'q-beta': [hit('https://b.com', 'Beta')],
      };
      return (map[q] ?? []).slice(0, k);
    },
    scrape: async (url: string) =>
      (({ 'https://a.com': 'alpha content long enough to keep', 'https://b.com': 'beta content long enough to keep' }) as Record<string, string>)[url] ?? '',
  };
}

function spyBridge(memory: CkgMemorySource[] = []): CkgBridge & {
  recall: ReturnType<typeof vi.fn>;
  ingest: ReturnType<typeof vi.fn>;
} {
  return {
    recall: vi.fn(async () => memory),
    ingest: vi.fn(async (s: CkgIngestableSource[]) => s.length),
  };
}

describe('WideResearchOrchestrator.deepResearch — Phase D (CKG) wiring', () => {
  it('ON: tees scrape → ingests the deduped sources with content, recalls, augments the report', async () => {
    const orch = new WideResearchOrchestrator();
    const bridge = spyBridge([{ id: 'id:prior', text: 'the collective already knew this', agentId: 'peer/x' }]);

    const result = await orch.deepResearch('Explain it', 'test-key', {}, {}, injectedBoundaries(), {
      enabled: true,
      bridge,
    });

    // two deduped web sources produced by the real pipeline
    expect(result.sources.map((s) => s.url)).toEqual(['https://a.com', 'https://b.com']);

    // recall ran on the question
    expect(bridge.recall).toHaveBeenCalledWith('Explain it', 6);

    // ingest received the deduped sources WITH the scraped content (tee worked)
    expect(bridge.ingest).toHaveBeenCalledTimes(1);
    const ingested = bridge.ingest.mock.calls[0]![0] as CkgIngestableSource[];
    expect(ingested.map((s) => s.url)).toEqual(['https://a.com', 'https://b.com']);
    expect(ingested[0]!.content).toContain('alpha content');
    expect(ingested[1]!.content).toContain('beta content');

    // recalled memory injected distinctly into the report
    expect(result.report).toContain('## Mémoire collective');
    expect(result.report).toContain('[M1] the collective already knew this — par peer/x');
    // web references untouched
    expect(result.report).toContain('[1] Alpha — https://a.com');
    expect((result as { ckg?: { recalled: number; ingested: number } }).ckg).toMatchObject({
      recalled: 1,
      ingested: 2,
    });
  });

  it('OFF (enabled:false): recall/ingest never called AND the report equals a no-CKG run (byte-identical)', async () => {
    const orch = new WideResearchOrchestrator();
    const bridge = spyBridge([{ id: 'id:prior', text: 'should never appear' }]);

    // With CKG disabled but a spy bridge injected.
    const off = await orch.deepResearch('Explain it', 'test-key', {}, {}, injectedBoundaries(), {
      enabled: false,
      bridge,
    });
    // With NO CKG arg at all (the pristine Phase-A/B path).
    const pristine = await orch.deepResearch('Explain it', 'test-key', {}, {}, injectedBoundaries());

    expect(bridge.recall).not.toHaveBeenCalled();
    expect(bridge.ingest).not.toHaveBeenCalled();
    expect(off.report).not.toContain('## Mémoire collective');
    expect((off as { ckg?: unknown }).ckg).toBeUndefined();
    // byte-identical report + sources between the disabled-CKG run and the pristine run
    expect(off.report).toBe(pristine.report);
    expect(off.sources).toEqual(pristine.sources);
  });

  it('combinable with the Phase-B loop (--iterations): still recalls + ingests', async () => {
    const orch = new WideResearchOrchestrator();
    const bridge = spyBridge([{ id: 'id:prior', text: 'prior knowledge' }]);

    const result = await orch.deepResearch('Explain it', 'test-key', {}, { rounds: 2 }, injectedBoundaries(), {
      enabled: true,
      bridge,
    });

    expect(bridge.recall).toHaveBeenCalledTimes(1);
    expect(bridge.ingest).toHaveBeenCalledTimes(1);
    expect(result.report).toContain('## Mémoire collective');
    expect(result.rounds).toBeGreaterThanOrEqual(1);
  });
});

describe('WideResearchOrchestrator.stormResearch — Phase D (CKG) wiring', () => {
  it('ON: STORM run recalls + ingests the merged perspective sources, augments the article', async () => {
    const orch = new WideResearchOrchestrator();
    const bridge = spyBridge([{ id: 'id:prior', text: 'prior storm knowledge' }]);

    const result = await orch.stormResearch('Explain it', 'test-key', {}, { perspectives: 2 }, injectedBoundaries(), {
      enabled: true,
      bridge,
    });

    expect(bridge.recall).toHaveBeenCalledWith('Explain it', 6);
    expect(bridge.ingest).toHaveBeenCalledTimes(1);
    expect(result.report).toContain('## Mémoire collective');
    // STORM-specific fields survive the wrapper
    expect(Array.isArray(result.perspectives)).toBe(true);
  });

  it('OFF: STORM run does not touch the bridge and stays byte-identical', async () => {
    const orch = new WideResearchOrchestrator();
    const bridge = spyBridge([{ id: 'id:prior', text: 'nope' }]);

    const off = await orch.stormResearch('Explain it', 'test-key', {}, { perspectives: 2 }, injectedBoundaries(), {
      enabled: false,
      bridge,
    });
    const pristine = await orch.stormResearch('Explain it', 'test-key', {}, { perspectives: 2 }, injectedBoundaries());

    expect(bridge.recall).not.toHaveBeenCalled();
    expect(bridge.ingest).not.toHaveBeenCalled();
    expect(off.report).not.toContain('## Mémoire collective');
    expect(off.report).toBe(pristine.report);
  });
});
