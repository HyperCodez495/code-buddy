/**
 * `buddy research --deep --perspectives N` (Phase C, STORM) CLI wiring.
 *
 * Proves the Phase-C opt-in guarantees:
 *  1. STRICT opt-in — `runDeepResearchCli` routes to `stormResearch` ONLY when
 *     `storm` is set; absent ⇒ the exact Phase-A/B `deepResearch` path runs and
 *     `stormResearch` is NEVER touched (byte-identical guarantee).
 *  2. With `storm`, `stormResearch` is called ONCE with the perspective count,
 *     and `deepResearch` is NOT called.
 *  3. The `--perspectives` / `--storm` options exist on the real command,
 *     defaulting OFF, and `--deep` is unchanged (still default false).
 *  4. `buildDeepReportFile` renders STORM metadata for a storm result while a
 *     plain Phase-A result is byte-unchanged (no STORM lines).
 */
import { describe, it, expect, vi } from 'vitest';

import {
  runDeepResearchCli,
  buildDeepReportFile,
  type DeepOrchestratorLike,
} from '../../../src/commands/research/deep.js';
import { createResearchCommand } from '../../../src/commands/research/index.js';
import type { DeepResearchResult, DeepResearchProgress } from '../../../src/agent/wide-research.js';
import type { StormResearchResult } from '../../../src/agent/deep-research-storm.js';

function fakeDeepResult(): DeepResearchResult {
  return {
    question: 'Q',
    plan: { question: 'Q', subQuestions: [{ subQuestion: 'SQ', queries: ['q1'] }] },
    sources: [{ id: 1, url: 'https://a.com', title: 'Alpha' }],
    report: '## TL;DR\n\nBody [1].\n\n## Références\n\n[1] Alpha — https://a.com',
    durationMs: 10,
    plannerLlmUsed: true,
    synthesisLlmUsed: true,
    duplicatesDropped: 0,
  };
}

function fakeStormResult(): StormResearchResult {
  return {
    ...fakeDeepResult(),
    sources: [
      { id: 1, url: 'https://a.com', title: 'Alpha' },
      { id: 2, url: 'https://b.com', title: 'Beta' },
    ],
    report:
      '# Article\n\n## Table des matières\n\n1. Background\n\n## Background\n\nText [1][2].\n\n## Références\n\n[1] Alpha — https://a.com\n[2] Beta — https://b.com',
    duplicatesDropped: 1,
    perspectives: [
      { perspective: { id: 'practitioner', label: 'Practitioner', angle: 'a', focus: [] }, sourceCount: 1, subQuestions: 1, failed: false, plannerLlmUsed: true },
      { perspective: { id: 'skeptic', label: 'Skeptic', angle: 'a', focus: [] }, sourceCount: 1, subQuestions: 1, failed: false, plannerLlmUsed: true },
    ],
    outline: { title: 'Article', sections: [{ title: 'Background' }] },
    outlineLlmUsed: true,
    coWritten: true,
  };
}

/** A spy orchestrator exposing BOTH deepResearch and stormResearch. */
function spyOrchestrator(opts: { deep: DeepResearchResult; storm: StormResearchResult }) {
  const deepResearch = vi.fn(async () => opts.deep);
  const stormResearch = vi.fn(async () => opts.storm);
  const orch: DeepOrchestratorLike = {
    on: (_e, _l) => undefined,
    deepResearch,
    stormResearch,
  };
  return { orch, deepResearch, stormResearch };
}

describe('runDeepResearchCli — STORM strict opt-in (byte-identical guarantee)', () => {
  it('does NOT call stormResearch when storm is absent — deep path runs unchanged', async () => {
    const { orch, deepResearch, stormResearch } = spyOrchestrator({
      deep: fakeDeepResult(),
      storm: fakeStormResult(),
    });

    const logs: string[] = [];
    await runDeepResearchCli(
      'Q',
      'key',
      { model: 'm' },
      { deep: true, deepOptions: { rounds: 1 } }, // NO storm
      { log: (m) => logs.push(m), makeOrchestrator: () => orch },
    );

    expect(deepResearch).toHaveBeenCalledTimes(1);
    expect(stormResearch).not.toHaveBeenCalled();
    // rendered the deep (not storm) report
    expect(logs.join('\n')).toContain('## Références');
  });

  it('routes to stormResearch exactly once (with the perspective count) when storm is set', async () => {
    const { orch, deepResearch, stormResearch } = spyOrchestrator({
      deep: fakeDeepResult(),
      storm: fakeStormResult(),
    });

    await runDeepResearchCli(
      'Q',
      'key',
      { model: 'm' },
      { deep: true, storm: true, perspectives: 4, deepOptions: { rounds: 1 } },
      { makeOrchestrator: () => orch },
    );

    expect(stormResearch).toHaveBeenCalledTimes(1);
    expect(deepResearch).not.toHaveBeenCalled();
    // perspectives threaded through as the stormOptions
    const stormOptions = stormResearch.mock.calls[0]![3] as { perspectives?: number } | undefined;
    expect(stormOptions?.perspectives).toBe(4);
  });

  it('falls back to deepResearch when the orchestrator has no stormResearch (defensive)', async () => {
    const deepResearch = vi.fn(async () => fakeDeepResult());
    const orch: DeepOrchestratorLike = { on: () => undefined, deepResearch };
    await runDeepResearchCli(
      'Q',
      'key',
      {},
      { deep: true, storm: true, perspectives: 4 },
      { makeOrchestrator: () => orch },
    );
    expect(deepResearch).toHaveBeenCalledTimes(1);
  });

  it('renders STORM progress lines when the orchestrator emits the storm channel', async () => {
    const logs: string[] = [];
    const storm = fakeStormResult();
    let listener: ((e: DeepResearchProgress | { type: 'storm'; stage: string; count?: number; total?: number; dropped?: number; sections?: number; llmUsed?: boolean; sources?: number; coWritten?: boolean }) => void) | undefined;
    const orch: DeepOrchestratorLike = {
      on: (_e, l) => { listener = l as typeof listener; return undefined; },
      deepResearch: async () => fakeDeepResult(),
      stormResearch: async () => {
        listener?.({ type: 'storm', stage: 'perspectives-ready', count: 4 });
        listener?.({ type: 'storm', stage: 'merged-perspectives', total: 5, dropped: 1 });
        listener?.({ type: 'storm', stage: 'outlined', sections: 3, llmUsed: true });
        listener?.({ type: 'storm', stage: 'storm-done', sources: 5 });
        return storm;
      },
    };

    await runDeepResearchCli('Q', 'key', {}, { deep: true, storm: true, perspectives: 4 }, {
      log: (m) => logs.push(m),
      makeOrchestrator: () => orch,
    });

    const out = logs.join('\n');
    expect(out).toContain('4 perspective(s) ready');
    expect(out).toContain('5 shared source(s)');
    expect(out).toContain('STORM Deep Research complete');
  });
});

describe('research command --perspectives / --storm options', () => {
  it('exposes --perspectives (default 0) and --storm (default off), --deep unchanged', () => {
    const cmd = createResearchCommand();
    expect(cmd.options.find((o) => o.long === '--perspectives')).toBeDefined();
    expect(cmd.options.find((o) => o.long === '--storm')).toBeDefined();
    const opts = cmd.opts() as { perspectives?: string; storm?: boolean; deep?: boolean };
    expect(opts.perspectives).toBe('0');
    expect(opts.storm).toBe(false);
    expect(opts.deep).toBe(false); // Phase-A/B flag untouched
  });
});

describe('buildDeepReportFile — STORM metadata (additive)', () => {
  it('renders perspective + outline lines for a storm result', () => {
    const out = buildDeepReportFile('My Topic', fakeStormResult(), 'TestProvider');
    expect(out).toContain('Mode: deep (STORM multi-perspective)');
    expect(out).toContain('Perspectives: 2 (Practitioner, Skeptic)');
    expect(out).toContain('Outline: 1 section(s) | Article: outline-first co-written');
    expect(out).toContain('## Table des matières');
    expect(out).toContain('Provider: TestProvider');
  });

  it('a plain Phase-A result is byte-unchanged (no STORM lines)', () => {
    const out = buildDeepReportFile('My Topic', fakeDeepResult());
    expect(out).toContain('Mode: deep');
    expect(out).not.toContain('STORM multi-perspective');
    expect(out).not.toContain('Perspectives:');
    expect(out).not.toContain('Outline:');
  });
});
