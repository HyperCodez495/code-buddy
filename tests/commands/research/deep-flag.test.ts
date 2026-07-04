/**
 * `buddy research --deep` CLI wiring.
 *
 * Proves the two Phase-A CLI guarantees:
 *  1. Strict opt-in gate — `maybeRunDeepResearch` runs the deep path ONLY when
 *     `--deep` is present; absent ⇒ the deep runner is NEVER invoked (so the
 *     Wide/direct research behaviour below is byte-identical). This mirrors the
 *     video pipeline's "flag off = unchanged" proof.
 *  2. The `--deep` option exists on the real research command.
 *  3. `runDeepResearchCli` renders progress + persists a cited report using an
 *     injected orchestrator (no network).
 */
import { describe, it, expect, vi } from 'vitest';

import {
  maybeRunDeepResearch,
  runDeepResearchCli,
  buildDeepReportFile,
  type DeepOrchestratorLike,
} from '../../../src/commands/research/deep.js';
import { createResearchCommand } from '../../../src/commands/research/index.js';
import type { DeepResearchResult, DeepResearchProgress } from '../../../src/agent/wide-research.js';

function fakeResult(): DeepResearchResult {
  return {
    question: 'Q',
    plan: { question: 'Q', subQuestions: [{ subQuestion: 'SQ', queries: ['q1'] }] },
    sources: [
      { id: 1, url: 'https://a.com', title: 'Alpha' },
      { id: 2, url: 'https://b.com', title: 'Beta' },
    ],
    report: '## TL;DR\n\nBody citing [1][2].\n\n## Références\n\n[1] Alpha — https://a.com\n[2] Beta — https://b.com',
    durationMs: 1234,
    plannerLlmUsed: true,
    synthesisLlmUsed: true,
    duplicatesDropped: 1,
  };
}

function fakeOrchestrator(result: DeepResearchResult): DeepOrchestratorLike {
  let listener: ((e: DeepResearchProgress) => void) | undefined;
  return {
    on: (_event, l) => { listener = l as (e: DeepResearchProgress) => void; return undefined; },
    deepResearch: async () => {
      listener?.({ type: 'deep', stage: 'planning' });
      listener?.({ type: 'deep', stage: 'planned', subQuestions: 1, queries: 1, llmUsed: true });
      listener?.({ type: 'deep', stage: 'done', sources: result.sources.length });
      return result;
    },
  };
}

describe('maybeRunDeepResearch (strict opt-in gate)', () => {
  it('does NOT run the deep path when --deep is absent (byte-identical guarantee)', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    for (const opts of [{}, { deep: false }, { deep: undefined }]) {
      const handled = await maybeRunDeepResearch(opts, run);
      expect(handled).toBe(false);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the deep path exactly once when --deep is present', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const handled = await maybeRunDeepResearch({ deep: true }, run);
    expect(handled).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('research command --deep option', () => {
  it('exposes the --deep flag, defaulting off', () => {
    const cmd = createResearchCommand();
    const deep = cmd.options.find((o) => o.long === '--deep');
    expect(deep).toBeDefined();
    // Commander default for a boolean flag declared with `false`.
    const opts = cmd.opts() as { deep?: boolean };
    expect(opts.deep).toBe(false);
  });
});

describe('runDeepResearchCli (injected orchestrator, no network)', () => {
  it('persists a cited report to the requested file and logs progress', async () => {
    const logs: string[] = [];
    const written: Array<{ file: string; content: string }> = [];
    const result = fakeResult();

    await runDeepResearchCli(
      'Q',
      'key',
      { model: 'm' },
      { deep: true, reportPath: 'out/report.md', providerLabel: 'TestProvider' },
      {
        log: (m) => logs.push(m),
        makeOrchestrator: () => fakeOrchestrator(result),
        writeFile: async (file, content) => { written.push({ file, content }); },
      },
    );

    expect(written).toHaveLength(1);
    expect(written[0]!.file).toBe('out/report.md');
    expect(written[0]!.content).toContain('Mode: deep');
    expect(written[0]!.content).toContain('## Références');
    expect(written[0]!.content).toContain('[1] Alpha — https://a.com');
    expect(logs.join('\n')).toContain('Deep Research complete');
  });

  it('prints the report to stdout when no report file is requested', async () => {
    const logs: string[] = [];
    await runDeepResearchCli(
      'Q',
      'key',
      {},
      { deep: true },
      { log: (m) => logs.push(m), makeOrchestrator: () => fakeOrchestrator(fakeResult()) },
    );
    expect(logs.join('\n')).toContain('## Références');
  });

  it('writes a failure report (never throws) when the pipeline rejects', async () => {
    const written: Array<{ file: string; content: string }> = [];
    const throwingOrch: DeepOrchestratorLike = {
      on: () => undefined,
      deepResearch: async () => { throw new Error('kaboom'); },
    };
    await expect(
      runDeepResearchCli(
        'Q',
        'key',
        {},
        { deep: true, reportPath: 'out/fail.md' },
        {
          log: () => undefined,
          errorLog: () => undefined,
          makeOrchestrator: () => throwingOrch,
          writeFile: async (file, content) => { written.push({ file, content }); },
        },
      ),
    ).resolves.toBeUndefined();
    expect(written[0]!.content).toContain('Status: failed');
    expect(written[0]!.content).toContain('kaboom');
  });
});

describe('buildDeepReportFile', () => {
  it('assembles metadata preface + report body, omitting provider when absent', () => {
    const out = buildDeepReportFile('My Topic', fakeResult());
    expect(out).toContain('# Deep Research: My Topic');
    expect(out).toContain('Sources: 2 (1 near-duplicate(s) dropped)');
    expect(out).not.toContain('Provider:');
    expect(out).toContain('## TL;DR');
  });
});
