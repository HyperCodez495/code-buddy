/**
 * Fleet council — consensus aggregator tests.
 *
 * Covers the deterministic `computeTextConsensus` helper and the
 * `aggregateWithConsensus` council aggregator. The LLM is mocked at the
 * client level (same pattern as saga-store.test.ts) — no real calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  aggregateWithConsensus,
  computeTextConsensus,
  wireAggregatorClient,
  _unwireAggregatorClient,
  type ConsensusSource,
} from '../../src/fleet/result-aggregator';
import type { SagaRecord } from '../../src/fleet/saga-store';
import type { DispatchPlan } from '../../src/fleet/task-router';

function makeParallelPlan(): DispatchPlan {
  const lane = (peerId: string, model: string) => ({
    peerId,
    model,
    score: 0.9,
    breakdown: { match: 1, cost: 1, load: 1, latency: 1 },
  });
  return {
    primary: lane('p1', 'm1'),
    parallel: [lane('p1', 'm1'), lane('p2', 'm2')],
    rationale: 'council test',
  };
}

function makeSagaWithResults(results: string[]): SagaRecord {
  const steps = results.map((r, i) => ({
    peerId: `p${i + 1}`,
    model: `m${i + 1}`,
    lane: 'parallel' as const,
    status: 'completed' as const,
    result: r,
  }));
  return {
    id: 's',
    goal: 'test goal',
    plan: makeParallelPlan(),
    steps,
    status: 'completed',
    metadata: {},
    createdAt: 0,
    updatedAt: 0,
  };
}

function sources(...texts: string[]): ConsensusSource[] {
  return texts.map((text, i) => ({ peerId: `p${i + 1}`, model: `m${i + 1}`, text }));
}

afterEach(() => {
  _unwireAggregatorClient();
  vi.clearAllMocks();
});

describe('computeTextConsensus', () => {
  it('returns empty/not-reached for zero sources', () => {
    const c = computeTextConsensus([]);
    expect(c.total).toBe(0);
    expect(c.score).toBe(0);
    expect(c.reached).toBe(false);
    expect(c.perSource).toEqual([]);
    expect(c.disagreements).toEqual([]);
  });

  it('treats a single source as vacuous full agreement', () => {
    const c = computeTextConsensus(sources('the only answer'));
    expect(c.total).toBe(1);
    expect(c.score).toBe(1);
    expect(c.reached).toBe(true);
    expect(c.agreeingCount).toBe(1);
    expect(c.disagreements).toEqual([]);
  });

  it('scores identical answers as full consensus', () => {
    const c = computeTextConsensus(sources('alpha beta gamma', 'alpha beta gamma'));
    expect(c.score).toBe(1);
    expect(c.reached).toBe(true);
    expect(c.agreeingCount).toBe(2);
    expect(c.disagreements).toEqual([]);
  });

  it('scores fully disjoint answers as zero consensus', () => {
    const c = computeTextConsensus(sources('alpha beta gamma', 'delta epsilon zeta'));
    expect(c.score).toBe(0);
    expect(c.reached).toBe(false);
    expect(c.agreeingCount).toBe(0);
    expect(c.disagreements).toHaveLength(2);
    expect(c.disagreements[0]!.peerId).toBe('p1');
  });

  it('honours a custom threshold', () => {
    // Two answers sharing half their words → Jaccard 1/3 ≈ 0.33.
    const lo = computeTextConsensus(sources('a b c d', 'a b e f'), 0.7);
    expect(lo.reached).toBe(false);
    const hi = computeTextConsensus(sources('a b c d', 'a b e f'), 0.2);
    expect(hi.reached).toBe(true);
  });

  it('reports per-source agreement and flags the outlier', () => {
    // Two agree, one diverges entirely.
    const c = computeTextConsensus(
      sources('shared common words here', 'shared common words here', 'totally different tokens entirely'),
    );
    const outlier = c.perSource.find((p) => p.peerId === 'p3')!;
    const agreeing = c.perSource.find((p) => p.peerId === 'p1')!;
    expect(outlier.agreement).toBeLessThan(agreeing.agreement);
    expect(c.disagreements.some((d) => d.peerId === 'p3')).toBe(true);
  });
});

describe('aggregateWithConsensus', () => {
  it('throws when no completed steps', async () => {
    const saga = makeSagaWithResults([]);
    await expect(aggregateWithConsensus(saga)).rejects.toThrow(/no completed/);
  });

  it('returns the single answer and full consensus for one step', async () => {
    const saga = makeSagaWithResults(['only one']);
    const { finalText, consensus } = await aggregateWithConsensus(saga);
    expect(finalText).toBe('only one');
    expect(consensus.total).toBe(1);
    expect(consensus.reached).toBe(true);
  });

  it('falls back to concatenation when no client is wired (but still returns consensus)', async () => {
    const saga = makeSagaWithResults(['answer A', 'answer B']);
    const { finalText, consensus } = await aggregateWithConsensus(saga);
    expect(finalText).toContain('answer A');
    expect(finalText).toContain('answer B');
    expect(finalText).toContain('Source 1');
    expect(consensus.total).toBe(2);
    expect(typeof consensus.score).toBe('number');
  });

  it('uses the wired LLM client to arbitrate and passes the consensus signal in the prompt', async () => {
    const chat = vi.fn(async () => ({
      choices: [{ message: { role: 'assistant', content: 'arbitrated answer' }, finish_reason: 'stop' }],
    }));
    wireAggregatorClient(() => ({ chat }) as never);
    const saga = makeSagaWithResults(['A', 'B', 'C']);
    const { finalText, consensus } = await aggregateWithConsensus(saga);
    expect(finalText).toBe('arbitrated answer');
    expect(chat).toHaveBeenCalledTimes(1);
    // The user prompt should carry the measured consensus percentage.
    const messages = chat.mock.calls[0]![0] as Array<{ role: string; content: string }>;
    const userMsg = messages.find((m) => m.role === 'user')!;
    expect(userMsg.content).toMatch(/consensus mesuré/i);
    expect(consensus.total).toBe(3);
  });

  it('falls back to concat if the LLM returns empty content', async () => {
    const chat = vi.fn(async () => ({
      choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
    }));
    wireAggregatorClient(() => ({ chat }) as never);
    const saga = makeSagaWithResults(['x', 'y']);
    const { finalText } = await aggregateWithConsensus(saga);
    expect(finalText).toContain('Source 1');
  });

  it('falls back to concat if the LLM throws', async () => {
    const chat = vi.fn(async () => {
      throw new Error('rate limit');
    });
    wireAggregatorClient(() => ({ chat }) as never);
    const saga = makeSagaWithResults(['x', 'y']);
    const { finalText, consensus } = await aggregateWithConsensus(saga);
    expect(finalText).toContain('Source 1');
    expect(consensus.total).toBe(2);
  });
});
