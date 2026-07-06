/**
 * stream-stall-guard — real tests: a healthy stream passes through, a stalled
 * stream fails fast with LlmStallError (and closes the source), the guard can
 * be disabled, and the env resolver parses budgets.
 */
import { describe, expect, it } from 'vitest';
import { LlmStallError, resolveStallTimeoutMs, withStallGuard } from '../../src/utils/stream-stall-guard.js';

async function* healthy(): AsyncGenerator<string> {
  yield 'a';
  yield 'b';
}

function stalled(): AsyncIterable<string> & { closed: boolean } {
  const obj = {
    closed: false,
    [Symbol.asyncIterator]() {
      return {
        next: () =>
          new Promise<IteratorResult<string>>(() => {
            /* never resolves — the backend went silent */
          }),
        return: async () => {
          obj.closed = true;
          return { done: true as const, value: undefined };
        },
      };
    },
  };
  return obj;
}

describe('withStallGuard', () => {
  it('passes a healthy stream through untouched', async () => {
    const chunks: string[] = [];
    for await (const c of withStallGuard(healthy(), 5000)) chunks.push(c);
    expect(chunks).toEqual(['a', 'b']);
  });

  it('fails fast on a silent stream and closes the source', async () => {
    const source = stalled();
    const started = Date.now();
    await expect(async () => {
      for await (const c of withStallGuard(source, 120)) void c;
    }).rejects.toThrow(LlmStallError);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(source.closed).toBe(true);
  });

  it('is disabled when the budget is <= 0', async () => {
    const chunks: string[] = [];
    for await (const c of withStallGuard(healthy(), 0)) chunks.push(c);
    expect(chunks).toEqual(['a', 'b']);
  });
});

describe('resolveStallTimeoutMs', () => {
  it('defaults to 120s, honours the env var, tolerates garbage', () => {
    expect(resolveStallTimeoutMs({})).toBe(120_000);
    expect(resolveStallTimeoutMs({ CODEBUDDY_LLM_STALL_TIMEOUT_MS: '30000' })).toBe(30_000);
    expect(resolveStallTimeoutMs({ CODEBUDDY_LLM_STALL_TIMEOUT_MS: '0' })).toBe(0);
    expect(resolveStallTimeoutMs({ CODEBUDDY_LLM_STALL_TIMEOUT_MS: 'nope' })).toBe(120_000);
  });
});
