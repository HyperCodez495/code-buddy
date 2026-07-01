/**
 * LLM reviewers — strict-JSON verdicts, fail-closed on anything unreliable.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { DEFAULT_REVIEW_LENSES, reviewWithLens } from '../../src/review/llm-reviewer.js';
import type { CouncilChatClient } from '../../src/council/types.js';
import type { ProposedDiff } from '../../src/review/types.js';

const LENS = DEFAULT_REVIEW_LENSES[0]!; // correctness

function fakeClient(reply: string, seen?: string[]): CouncilChatClient {
  return {
    async chat(messages) {
      if (seen) seen.push(messages.map((m) => m.content).join('\n'));
      return { content: reply, promptTokens: 10, totalTokens: 20 };
    },
  };
}

function sampleDiff(): ProposedDiff {
  return {
    id: 'diff-abc',
    createdAt: '2026-07-02T00:00:00.000Z',
    workDir: '/tmp/x',
    origin: { kind: 'agent', label: 't' },
    intent: 'fix the parser',
    files: [
      {
        path: 'src/parser.ts',
        action: 'modify',
        baseContent: 'const x = 1;\n',
        baseHash: 'abc',
        newContent: 'const x = 2;\n',
      },
    ],
  };
}

describe('reviewWithLens', () => {
  it('parses a strict-JSON verdict with annotations', async () => {
    const seen: string[] = [];
    const client = fakeClient(
      '{"decision":"annotate","annotations":[{"path":"src/parser.ts","line":1,"severity":"warning","message":"off-by-one on x","suggestedFix":"const x = 3;"}],"why":"suspicious"}',
      seen,
    );
    const report = await reviewWithLens(client, LENS, sampleDiff(), 1000);

    expect(report.decision).toBe('annotate');
    expect(report.failClosed).toBeUndefined();
    expect(report.annotations).toEqual([
      { path: 'src/parser.ts', line: 1, severity: 'warning', message: 'off-by-one on x', suggestedFix: 'const x = 3;' },
    ]);
    // The reviewer saw the intent and the unified preview.
    expect(seen[0]).toContain('fix the parser');
    expect(seen[0]).toContain('src/parser.ts');
  });

  it('salvages JSON wrapped in prose', async () => {
    const client = fakeClient('Sure, here is my review: {"decision":"accept","annotations":[],"why":"clean"} hope it helps');
    const report = await reviewWithLens(client, LENS, sampleDiff(), 1000);
    expect(report.decision).toBe('accept');
  });

  it('fails CLOSED on non-JSON — never a silent pass', async () => {
    const client = fakeClient('LGTM, ship it!');
    const report = await reviewWithLens(client, LENS, sampleDiff(), 1000);

    expect(report.decision).toBe('reject');
    expect(report.failClosed).toBe(true);
    expect(report.annotations[0]!.severity).toBe('blocker');
    expect(report.annotations[0]!.message).toMatch(/review unavailable/);
  });

  it('fails CLOSED on client error and on timeout', async () => {
    const broken: CouncilChatClient = {
      async chat() {
        throw new Error('provider down');
      },
    };
    expect((await reviewWithLens(broken, LENS, sampleDiff(), 1000)).failClosed).toBe(true);

    const hanging: CouncilChatClient = { chat: () => new Promise(() => {}) };
    const timedOut = await reviewWithLens(hanging, LENS, sampleDiff(), 20);
    expect(timedOut.failClosed).toBe(true);
    expect(timedOut.annotations[0]!.message).toMatch(/timeout/);
  });

  it('never lets the decision be laxer than the annotations', async () => {
    const client = fakeClient(
      '{"decision":"accept","annotations":[{"path":"src/parser.ts","severity":"blocker","message":"deletes the null check"}],"why":"contradictory"}',
    );
    const report = await reviewWithLens(client, LENS, sampleDiff(), 1000);
    expect(report.decision).toBe('reject'); // blocker wins over the claimed accept
  });

  it('normalizes unknown severities and unknown paths defensively', async () => {
    const client = fakeClient(
      '{"decision":"annotate","annotations":[{"path":"invented.ts","severity":"catastrophic","message":"weird"}],"why":"x"}',
    );
    const report = await reviewWithLens(client, LENS, sampleDiff(), 1000);
    expect(report.annotations[0]!.path).toBe('src/parser.ts'); // remapped to a known path
    expect(report.annotations[0]!.severity).toBe('warning'); // unknown severity → warning
  });
});
