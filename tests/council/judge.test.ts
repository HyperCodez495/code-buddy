/**
 * Hardened council judge — abstention instead of biased fallbacks.
 *
 * The old judge picked the LONGEST answer on non-JSON and index 0 on error,
 * and fabricated a perfect score for the winner. These tests pin the new
 * contract: parse or abstain, never guess, never invent scores.
 */
import { describe, expect, it } from 'vitest';
import { extractJson, judgeAnswers, selectNeutralJudge } from '../../src/council/judge.js';
import type { CouncilCandidate, CouncilChatClient } from '../../src/council/types.js';

/** rng ≈ 1 makes the Fisher-Yates shuffle the identity permutation (A = answers[0]). */
const identityRng = (): number => 0.9999;

function fakeClient(reply: string, seen?: string[]): CouncilChatClient {
  return {
    async chat(messages) {
      if (seen) seen.push(messages.map((m) => m.content).join('\n'));
      return { content: reply, promptTokens: 10, totalTokens: 20 };
    },
  };
}

const CONFIG = { timeoutMs: 500, judgeModel: 'judge-model', neutral: true };

describe('judgeAnswers — hardened verdicts', () => {
  it('parses a strict-JSON verdict and maps scores through the shuffle', async () => {
    const client = fakeClient('{"scores":{"A":0.9,"B":0.3},"winner":"A","why":"more correct"}');
    const verdict = await judgeAnswers(client, 'task', [{ content: 'first' }, { content: 'second' }], CONFIG, identityRng);

    expect(verdict.kind).toBe('judged');
    expect(verdict.winnerIdx).toBe(0);
    expect(verdict.scores).toEqual([0.9, 0.3]);
    expect(verdict.rationale).toBe('more correct');
    expect(verdict.judgeModel).toBe('judge-model');
    expect(verdict.neutral).toBe(true);
  });

  it('abstains on a non-JSON reply — never falls back to the longest answer', async () => {
    const longAnswer = 'x'.repeat(5000);
    const client = fakeClient('I think the second answer is clearly the best one.');
    const verdict = await judgeAnswers(client, 'task', [{ content: 'short' }, { content: longAnswer }], CONFIG, identityRng);

    expect(verdict.kind).toBe('abstained');
    expect(verdict.winnerIdx).toBeNull();
    expect(verdict.scores).toEqual([0, 0]);
    expect(verdict.rationale).toContain('non-JSON');
  });

  it('abstains when the judge client fails — never defaults to index 0', async () => {
    const client: CouncilChatClient = {
      async chat() {
        throw new Error('provider down');
      },
    };
    const verdict = await judgeAnswers(client, 'task', [{ content: 'a' }, { content: 'b' }], CONFIG, identityRng);

    expect(verdict.kind).toBe('abstained');
    expect(verdict.winnerIdx).toBeNull();
    expect(verdict.rationale).toContain('provider down');
  });

  it('abstains on timeout', async () => {
    const client: CouncilChatClient = {
      chat: () => new Promise(() => {}),
    };
    const verdict = await judgeAnswers(client, 'task', [{ content: 'a' }], { ...CONFIG, timeoutMs: 20 }, identityRng);

    expect(verdict.kind).toBe('abstained');
    expect(verdict.rationale).toContain('timeout');
  });

  it('never fabricates a score: a JSON winner without scores keeps score 0', async () => {
    const client = fakeClient('{"winner":"A","why":"gut feeling"}');
    const verdict = await judgeAnswers(client, 'task', [{ content: 'a' }, { content: 'b' }], CONFIG, identityRng);

    expect(verdict.kind).toBe('judged');
    expect(verdict.winnerIdx).toBe(0);
    expect(verdict.scores).toEqual([0, 0]); // the old code forced scores[winner] = 1
  });

  it('falls back to argmax when the winner letter is unusable but scores exist', async () => {
    const client = fakeClient('{"scores":{"A":0.2,"B":0.8},"winner":"Z"}');
    const verdict = await judgeAnswers(client, 'task', [{ content: 'a' }, { content: 'b' }], CONFIG, identityRng);

    expect(verdict.kind).toBe('judged');
    expect(verdict.winnerIdx).toBe(1);
  });

  it('abstains when neither winner letter nor scores are usable', async () => {
    const client = fakeClient('{"winner":"Z","scores":{}}');
    const verdict = await judgeAnswers(client, 'task', [{ content: 'a' }, { content: 'b' }], CONFIG, identityRng);

    expect(verdict.kind).toBe('abstained');
  });

  it('parses dual task/role scores and discloses announced roles to the judge', async () => {
    const seen: string[] = [];
    const client = fakeClient(
      '{"scores":{"A":{"task":0.3,"role":0.9},"B":{"task":0.8,"role":0.6}},"winner":"B","verified":"recounted: 3","why":"ok"}',
      seen,
    );
    const verdict = await judgeAnswers(
      client,
      'task',
      [
        { content: 'conditional critique', roleLabel: 'Critique' },
        { content: 'direct answer', roleLabel: 'Synthèse' },
      ],
      CONFIG,
      identityRng,
    );

    expect(verdict.kind).toBe('judged');
    expect(verdict.winnerIdx).toBe(1); // winner chosen on TASK scores
    expect(verdict.scores).toEqual([0.3, 0.8]);
    expect(verdict.roleScores).toEqual([0.9, 0.6]); // the critic holds its role
    expect(verdict.verified).toBe('recounted: 3');
    expect(seen[0]).toContain('rôle annoncé: Critique');
  });

  it('flags a failed judge CALL so the engine can penalise the judge model', async () => {
    const client: CouncilChatClient = {
      async chat() {
        throw new Error('backend 404');
      },
    };
    const verdict = await judgeAnswers(client, 'task', [{ content: 'a' }], CONFIG, identityRng);
    expect(verdict.kind).toBe('abstained');
    expect(verdict.judgeCallFailed).toBe(true);
  });

  it('does NOT flag non-JSON abstention as a call failure (model alive, just non-compliant)', async () => {
    const client = fakeClient('I cannot produce JSON, sorry.');
    const verdict = await judgeAnswers(client, 'task', [{ content: 'a' }], CONFIG, identityRng);
    expect(verdict.kind).toBe('abstained');
    expect(verdict.judgeCallFailed).toBeUndefined();
  });

  it('truncates oversized candidate answers in the judge prompt', async () => {
    const seen: string[] = [];
    const client = fakeClient('{"scores":{"A":0.5},"winner":"A"}', seen);
    await judgeAnswers(client, 'task', [{ content: 'y'.repeat(10_000) }], { ...CONFIG, maxCharsPerAnswer: 100 }, identityRng);

    expect(seen[0]).toContain('...[truncated for judging]');
    expect(seen[0]!.length).toBeLessThan(3000);
  });
});

describe('selectNeutralJudge — strict neutrality', () => {
  const c = (provider: string, model: string, apiKey = 'k'): CouncilCandidate => ({
    provider,
    model,
    ...(apiKey ? { apiKey } : {}),
    costInputUsdPerMtok: 0,
  });

  it('picks a strong model outside the panel and reports it neutral', () => {
    const all = [c('ollama', 'qwen-coder'), c('chatgpt', 'gpt-5.5'), c('grok', 'grok-4')];
    const picked = new Set(['qwen-coder', 'grok-4']);
    const sel = selectNeutralJudge(all, picked);

    expect(sel).not.toBeNull();
    expect(sel!.candidate.model).toBe('gpt-5.5');
    expect(sel!.neutral).toBe(true);
  });

  it('returns null when every strong model sits on the panel — never silently judges its own work', () => {
    const all = [c('chatgpt', 'gpt-5.5'), c('grok', 'grok-4')];
    const picked = new Set(['gpt-5.5', 'grok-4']);
    expect(selectNeutralJudge(all, picked)).toBeNull();
  });

  it('honours an explicit judge preference but reports non-neutrality for panel members', () => {
    const all = [c('chatgpt', 'gpt-5.5'), c('grok', 'grok-4')];
    const sel = selectNeutralJudge(all, new Set(['gpt-5.5']), 'gpt-5.5');

    expect(sel!.candidate.model).toBe('gpt-5.5');
    expect(sel!.neutral).toBe(false);
  });

  it('skips candidates without an apiKey', () => {
    const all = [c('chatgpt', 'gpt-5.5', ''), c('grok', 'grok-4')];
    const sel = selectNeutralJudge(all, new Set());
    expect(sel!.candidate.model).toBe('grok-4');
  });

  it('skips dead models (trailing consecutive failures) — a retired judge stops aborting deliberations', () => {
    const all = [c('chatgpt', 'gpt-5.1-codex'), c('grok', 'grok-3-fast')];
    const history = { consecutiveRecentFailures: (m: string) => (m === 'gpt-5.1-codex' ? 2 : 0) };

    const sel = selectNeutralJudge(all, new Set(), undefined, history);
    expect(sel!.candidate.model).toBe('grok-3-fast');

    // A single recent failure is not death.
    const lenient = { consecutiveRecentFailures: (m: string) => (m === 'gpt-5.1-codex' ? 1 : 0) };
    expect(selectNeutralJudge(all, new Set(), undefined, lenient)!.candidate.model).toBe('gpt-5.1-codex');
  });
});

describe('extractJson', () => {
  it('parses pure JSON and salvages embedded JSON', () => {
    expect(extractJson('{"winner":"A"}')).toEqual({ winner: 'A' });
    expect(extractJson('Sure! {"winner":"B"} — done.')).toEqual({ winner: 'B' });
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('')).toBeNull();
  });
});
