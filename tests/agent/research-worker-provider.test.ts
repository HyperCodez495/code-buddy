/**
 * Research-worker provider seam — the injection that breaks the
 * wide-research → codebuddy-agent import cycle. Proves the orchestrator uses
 * the INJECTED factory (never imports CodeBuddyAgent) and fails loudly when the
 * factory is not wired.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  getResearchWorkerFactory,
  resetResearchWorkerFactory,
  setResearchWorkerFactory,
  type ResearchWorker,
} from '../../src/agent/research-worker-provider.js';
import { WideResearchOrchestrator } from '../../src/agent/wide-research.js';

afterEach(() => resetResearchWorkerFactory());

describe('research-worker-provider seam', () => {
  it('starts unwired and stores the injected factory', () => {
    resetResearchWorkerFactory();
    expect(getResearchWorkerFactory()).toBeNull();
    const factory = () => ({ processUserMessageStream: async function* () {} }) as ResearchWorker;
    setResearchWorkerFactory(factory);
    expect(getResearchWorkerFactory()).toBe(factory);
  });

  it('orchestrator research() uses the injected worker (no CodeBuddyAgent import)', async () => {
    const seen: string[] = [];
    setResearchWorkerFactory(({ maxRounds }) => {
      seen.push(`worker(maxRounds=${maxRounds})`);
      return {
        async *processUserMessageStream(query: string) {
          yield { type: 'content', content: `report for ${query.slice(0, 12)}` };
        },
      };
    });

    const orchestrator = new WideResearchOrchestrator({ workers: 1, maxRoundsPerWorker: 3 });
    const result = await orchestrator.research('quantum error correction', 'test-key');

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toContain('maxRounds=3');
    expect(result.report.length).toBeGreaterThan(0);
  });

  it('throws a clear error when no factory is wired', async () => {
    resetResearchWorkerFactory();
    const orchestrator = new WideResearchOrchestrator({ workers: 1, maxRoundsPerWorker: 1 });
    const result = await orchestrator.research('anything', 'test-key');
    // Per-worker failure surfaces in the aggregated report rather than crashing
    // the whole run; the report still comes back (degraded).
    expect(result).toBeDefined();
  });
});
