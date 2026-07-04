/**
 * `buddy research --ckg` (Phase D) CLI wiring.
 *
 * Proves:
 *  1. the `--ckg` flag exists on the real research command, defaulting off;
 *  2. `runDeepResearchCli` threads the CKG activation to the orchestrator as the
 *     6th arg ONLY when `ckg` is set — absent ⇒ `undefined` (byte-identical);
 *  3. it works on both the deep and STORM paths;
 *  4. `buildDeepReportFile` renders the CKG metadata line only when the bridge ran.
 *
 * All orchestrator surfaces are injected fakes — zero network, zero ledger.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  runDeepResearchCli,
  buildDeepReportFile,
  type DeepOrchestratorLike,
} from '../../../src/commands/research/deep.js';
import { createResearchCommand } from '../../../src/commands/research/index.js';
import type { DeepResearchResult } from '../../../src/agent/wide-research.js';
import type { StormResearchResult } from '../../../src/agent/deep-research-storm.js';

function fakeDeepResult(): DeepResearchResult {
  return {
    question: 'Q',
    plan: { question: 'Q', subQuestions: [] },
    sources: [{ id: 1, url: 'https://a.com', title: 'Alpha' }],
    report: '## TL;DR\n\nBody [1].\n\n## Références\n\n[1] Alpha — https://a.com',
    durationMs: 5,
    plannerLlmUsed: true,
    synthesisLlmUsed: true,
    duplicatesDropped: 0,
  };
}

function fakeStormResult(): StormResearchResult {
  return {
    ...fakeDeepResult(),
    perspectives: [
      { perspective: { id: 'p', label: 'P', angle: 'a', focus: [] }, sourceCount: 1, subQuestions: 1, failed: false, plannerLlmUsed: true },
    ],
    outline: { title: 'T', sections: [{ title: 'S' }] },
    outlineLlmUsed: true,
    coWritten: true,
  };
}

function spyOrchestrator(): DeepOrchestratorLike & {
  deepResearch: ReturnType<typeof vi.fn>;
  stormResearch: ReturnType<typeof vi.fn>;
} {
  return {
    on: () => undefined,
    deepResearch: vi.fn(async () => fakeDeepResult()),
    stormResearch: vi.fn(async () => fakeStormResult()),
  };
}

describe('research command --ckg option', () => {
  it('exposes the --ckg flag, defaulting off', () => {
    const cmd = createResearchCommand();
    const ckg = cmd.options.find((o) => o.long === '--ckg');
    expect(ckg).toBeDefined();
    const opts = cmd.opts() as { ckg?: boolean };
    expect(opts.ckg).toBe(false);
  });
});

describe('runDeepResearchCli threads CKG activation to the orchestrator', () => {
  it('deep path: passes { enabled: true } as the 6th arg when ckg is set', async () => {
    const orch = spyOrchestrator();
    await runDeepResearchCli('Q', 'key', { model: 'm' }, { deep: true, ckg: true }, {
      log: () => undefined,
      makeOrchestrator: () => orch,
    });
    expect(orch.deepResearch).toHaveBeenCalledTimes(1);
    const call = orch.deepResearch.mock.calls[0]!;
    // (topic, apiKey, providerConfig, deepOptions, boundariesOverride, ckg)
    expect(call[4]).toBeUndefined(); // boundariesOverride stays undefined from the CLI
    expect(call[5]).toEqual({ enabled: true });
  });

  it('deep path: 6th arg is undefined when ckg is absent (byte-identical)', async () => {
    const orch = spyOrchestrator();
    await runDeepResearchCli('Q', 'key', {}, { deep: true }, {
      log: () => undefined,
      makeOrchestrator: () => orch,
    });
    const call = orch.deepResearch.mock.calls[0]!;
    expect(call[5]).toBeUndefined();
  });

  it('STORM path: passes { enabled: true } as the 6th arg, options still 4th', async () => {
    const orch = spyOrchestrator();
    await runDeepResearchCli('Q', 'key', {}, { deep: true, storm: true, perspectives: 4, ckg: true }, {
      log: () => undefined,
      makeOrchestrator: () => orch,
    });
    expect(orch.stormResearch).toHaveBeenCalledTimes(1);
    const call = orch.stormResearch.mock.calls[0]!;
    expect((call[3] as { perspectives?: number }).perspectives).toBe(4); // options unmoved
    expect(call[5]).toEqual({ enabled: true });
    expect(orch.deepResearch).not.toHaveBeenCalled();
  });
});

describe('buildDeepReportFile renders the CKG metadata line only when the bridge ran', () => {
  it('adds a "Mémoire collective (CKG)" line when result.ckg.enabled', () => {
    const result = { ...fakeDeepResult(), ckg: { enabled: true, recalled: 2, ingested: 3, memory: [] } };
    const out = buildDeepReportFile('My Topic', result as DeepResearchResult);
    expect(out).toContain('Mémoire collective (CKG): 2 rappelée(s), 3 ingérée(s)');
  });

  it('omits the CKG line entirely when the result has no ckg outcome (byte-identical)', () => {
    const out = buildDeepReportFile('My Topic', fakeDeepResult());
    expect(out).not.toContain('Mémoire collective (CKG)');
  });
});
