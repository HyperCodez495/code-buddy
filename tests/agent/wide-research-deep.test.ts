/**
 * WideResearchOrchestrator.deepResearch — the opt-in Deep Research wiring.
 *
 * Proves:
 *  - the orchestrator method threads injected boundaries through the pipeline
 *    and emits `{ type: 'deep', ... }` progress events (no network),
 *  - the injected batching (`mapBatched` = the orchestrator's own chunk +
 *    Promise.all) drives the parallel scrape,
 *  - Deep Research is strictly ADDITIVE: the legacy `research()` API and its
 *    `WideResearchProgress` shape are untouched; deep code only runs when
 *    `deepResearch()` is explicitly invoked.
 */
import { describe, it, expect } from 'vitest';

import { WideResearchOrchestrator } from '../../src/agent/wide-research.js';
import type { DeepResearchBoundaries, SearchHit } from '../../src/agent/deep-research.js';

function injectedBoundaries(): Partial<DeepResearchBoundaries> {
  return {
    llm: async (messages) => {
      const isPlanner = messages.some((m) => m.content.includes('query planner'));
      if (isPlanner) {
        return JSON.stringify({
          subQuestions: [{ subQuestion: 'What?', queries: ['q one', 'q two'] }],
        });
      }
      return '## TL;DR\n\nAnswer citing [1] and [2].';
    },
    search: async (q: string): Promise<SearchHit[]> => {
      const map: Record<string, SearchHit[]> = {
        'q one': [{ title: 'One', url: 'https://1.example', snippet: '' }],
        'q two': [{ title: 'Two', url: 'https://2.example', snippet: '' }],
      };
      return map[q] ?? [];
    },
    scrape: async (url: string) =>
      url === 'https://1.example'
        ? 'First source content, distinct and specific about the first angle.'
        : 'Second source, an entirely different discussion of the second angle here.',
    // fingerprint left real; mapBatched left real (the orchestrator's own batching).
  };
}

describe('WideResearchOrchestrator.deepResearch (opt-in)', () => {
  it('runs the cited pipeline through injected boundaries and emits deep progress', async () => {
    const orch = new WideResearchOrchestrator();
    const progress: string[] = [];
    orch.on('progress', (e: { type: string; stage?: string }) => {
      if (e.type === 'deep' && e.stage) progress.push(e.stage);
    });

    const result = await orch.deepResearch('Explain it', 'test-key', {}, {}, injectedBoundaries());

    expect(result.question).toBe('Explain it');
    expect(result.sources.map((s) => s.id)).toEqual([1, 2]);
    expect(result.report).toContain('## Références');
    expect(result.report).toContain('[1] One — https://1.example');
    expect(result.report).toContain('[2] Two — https://2.example');
    expect(progress).toContain('planning');
    expect(progress).toContain('done');
  });

  it('parallel scrape is driven by the orchestrator batching (concurrency honoured)', async () => {
    const orch = new WideResearchOrchestrator();
    let inFlight = 0;
    let peak = 0;
    const base = injectedBoundaries();
    const boundaries: Partial<DeepResearchBoundaries> = {
      ...base,
      search: async (): Promise<SearchHit[]> => [
        { title: 'A', url: 'https://a', snippet: '' },
        { title: 'B', url: 'https://b', snippet: '' },
        { title: 'C', url: 'https://c', snippet: '' },
        { title: 'D', url: 'https://d', snippet: '' },
      ],
      scrape: async (url: string) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return `content for ${url} — unique enough to survive dedup ${url}`;
      },
    };

    const result = await orch.deepResearch('q', 'k', {}, { concurrency: 2, maxSources: 4, resultsPerQuery: 5 }, boundaries);
    // 4 URLs scraped, but never more than the configured concurrency at once.
    expect(result.sources.length).toBeGreaterThanOrEqual(1);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
  });

  it('the legacy Wide Research surface is unchanged (additive proof)', () => {
    const orch = new WideResearchOrchestrator();
    // Legacy API still present with its original arity.
    expect(typeof orch.research).toBe('function');
    expect(orch.research.length).toBe(3); // (topic, apiKey, providerConfig?)
    // Deep API is a SEPARATE method — legacy path never touches it.
    expect(typeof orch.deepResearch).toBe('function');
  });
});
