import { describe, expect, it } from 'vitest';

import { SEED_BENCHMARK_SCENARIOS } from '../../../src/agent/self-improvement/capability-benchmark.js';
import type { LessonMutatorPort } from '../../../src/agent/self-improvement/empirical-gate.js';
import { SelfImprovementEngine } from '../../../src/agent/self-improvement/engine.js';
import { EvolutionaryArchive } from '../../../src/agent/self-improvement/evolutionary-archive.js';
import {
  LlmProposer,
  buildLessonDraftPrompt,
  type LessonDrafter,
} from '../../../src/agent/self-improvement/proposer.js';
import type { BenchmarkScenario } from '../../../src/agent/self-improvement/types.js';

function fakePort(): LessonMutatorPort & { items: Array<{ id: string; content: string; context?: string }> } {
  const items: Array<{ id: string; content: string; context?: string }> = [];
  let n = 0;
  return {
    items,
    search: (q) =>
      items.filter(
        (i) =>
          i.content.toLowerCase().includes(q.toLowerCase()) ||
          (i.context?.toLowerCase().includes(q.toLowerCase()) ?? false),
      ),
    add: (_c, content, context) => {
      const item = { id: `L${++n}`, content, context };
      items.push(item);
      return { id: item.id };
    },
    remove: (id) => {
      const i = items.findIndex((x) => x.id === id);
      if (i >= 0) items.splice(i, 1);
      return i >= 0;
    },
  };
}

const ONE: BenchmarkScenario[] = [
  { id: 'npm-test-path-filter', query: 'npm test', expectIncludes: ['path filter'], description: 'prefer a path filter' },
];

describe('LlmProposer (creative generation, deterministic empirical gate)', () => {
  it('builds a strict draft prompt grounded in the scenario and friction', () => {
    const prompt = buildLessonDraftPrompt(ONE[0]!, [
      { id: 'e1', source: 'run', kind: 'bash', detail: 'npm test timed out', context: 'tool: bash' },
    ]);
    expect(prompt).toContain('path filter'); // must-mention
    expect(prompt).toContain('npm test'); // retrievable-for query
    expect(prompt).toContain('npm test timed out'); // friction evidence
    expect(prompt).toContain('ONLY the lesson text');
  });

  it('applies an LLM draft that empirically improves the benchmark', async () => {
    const port = fakePort();
    const drafter: LessonDrafter = async () => ({
      category: 'RULE',
      content: 'When running npm test, pass a path filter so the suite stays fast.',
    });
    const engine = new SelfImprovementEngine({
      scenarios: ONE,
      port,
      proposer: new LlmProposer(drafter),
      archive: new EvolutionaryArchive({ workDir: process.cwd() }),
      autonomy: 'auto-apply',
    });
    const result = await engine.runCycle([
      { id: 'e1', source: 'run', kind: 'bash', detail: 'npm test timed out', context: 'tool: bash' },
    ]);
    expect(result.applied).toBe(true);
    expect(result.gate?.delta).toBe(1);
    expect(port.items).toHaveLength(1);
  });

  it('rejects a hallucinated/off-target LLM draft via the deterministic gate', async () => {
    const port = fakePort();
    const drafter: LessonDrafter = async () => ({
      category: 'RULE',
      content: 'Prefer tabs over spaces in all source files, always and forever everywhere.',
    });
    const engine = new SelfImprovementEngine({
      scenarios: ONE,
      port,
      proposer: new LlmProposer(drafter),
      archive: new EvolutionaryArchive({ workDir: process.cwd() }),
      autonomy: 'auto-apply',
    });
    const result = await engine.runCycle();
    expect(result.applied).toBe(false);
    expect(result.gate?.rejectionReason).toBe('no-improvement');
    expect(port.items).toHaveLength(0); // rolled back — nothing kept
  });

  it('declines cleanly when the drafter returns null', async () => {
    const port = fakePort();
    const engine = new SelfImprovementEngine({
      scenarios: ONE,
      port,
      proposer: new LlmProposer(async () => null),
      archive: new EvolutionaryArchive({ workDir: process.cwd() }),
      autonomy: 'auto-apply',
    });
    const result = await engine.runCycle();
    expect(result.proposalId).toBeNull();
    expect(result.applied).toBe(false);
  });
});
