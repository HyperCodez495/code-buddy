/**
 * buddy doctor — live LLM key validation (0 token). Injected fetch, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkLlmKeysLive } from '../../src/doctor/llm-key-check.js';

const KEY_VARS = ['OPENAI_API_KEY', 'GROK_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const v of KEY_VARS) {
    saved[v] = process.env[v];
    delete process.env[v];
  }
});

afterEach(() => {
  for (const v of KEY_VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

function fakeFetch(status: number) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status }) as Response);
}

describe('checkLlmKeysLive', () => {
  it('returns nothing when no key is configured', async () => {
    const f = fakeFetch(200);
    expect(await checkLlmKeysLive(f)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('reports ok on HTTP 200 (key accepted, 0 tokens)', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const f = fakeFetch(200);
    const checks = await checkLlmKeysLive(f);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.status).toBe('ok');
    expect(f).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-test' } }),
    );
  });

  it('distinguishes invalid key (401 → error) from exhausted quota (429 → warn)', async () => {
    process.env.OPENAI_API_KEY = 'sk-bad';
    const [invalid] = await checkLlmKeysLive(fakeFetch(401));
    expect(invalid!.status).toBe('error');
    expect(invalid!.message).toContain('REJECTED');

    const [quota] = await checkLlmKeysLive(fakeFetch(429));
    expect(quota!.status).toBe('warn');
    expect(quota!.message).toContain('quota');
  });

  it('is offline-safe: network failure → warn, never throws', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const f = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    const [check] = await checkLlmKeysLive(f as unknown as Parameters<typeof checkLlmKeysLive>[0]);
    expect(check!.status).toBe('warn');
    expect(check!.message).toContain('unreachable');
  });

  it('uses GEMINI_API_KEY with GOOGLE_API_KEY as fallback, key in query string', async () => {
    process.env.GOOGLE_API_KEY = 'g-key';
    const f = fakeFetch(200);
    const checks = await checkLlmKeysLive(f);
    expect(checks).toHaveLength(1);
    expect(String(f.mock.calls[0]![0])).toContain('key=g-key');
  });

  it('checks all configured providers in one pass', async () => {
    process.env.OPENAI_API_KEY = 'a';
    process.env.GROK_API_KEY = 'b';
    process.env.ANTHROPIC_API_KEY = 'c';
    const checks = await checkLlmKeysLive(fakeFetch(200));
    expect(checks.map((c) => c.status)).toEqual(['ok', 'ok', 'ok']);
  });
});
