/**
 * Fleet P2 — verify the capability registry detects configured
 * providers from env vars, gracefully skips network probes when
 * Ollama / LM Studio are not running, and produces a snapshot the
 * router can consume.
 *
 * The local network probes (Ollama on :11434, LM Studio on :1234)
 * are mocked via `global.fetch` so the test doesn't depend on what's
 * actually running on the machine.
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
  getLocalCapabilities,
  resetCapabilityCache,
} from '../../src/fleet/capability-registry';

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

function clearProviderEnv() {
  for (const k of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GROK_API_KEY',
    'MISTRAL_API_KEY',
    'CODEBUDDY_FLEET_HOSTNAME',
    'CODEBUDDY_FLEET_MACHINE_LABEL',
    'CODEBUDDY_FLEET_GPU',
    'CODEBUDDY_FLEET_RAM_GB',
    'CODEBUDDY_FLEET_MAX_CONCURRENCY',
  ]) {
    delete process.env[k];
  }
}

beforeEach(() => {
  clearProviderEnv();
  resetCapabilityCache();
  // Default: deny every fetch (Ollama / LM Studio probes return [])
  global.fetch = vi.fn(async () => {
    throw new Error('econn refused');
  }) as unknown as typeof fetch;
});

afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
});

describe('capability-registry — env-based detection', () => {
  it('returns no models when no env vars are set and no local daemons reachable', async () => {
    const cap = await getLocalCapabilities();
    expect(cap.models).toEqual([]);
    expect(cap.egress).toBe('local');
    expect(cap.machineLabel).toBeTruthy();
  });

  it('detects Anthropic when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-xxx';
    const cap = await getLocalCapabilities();
    const ids = cap.models.map((m) => m.id);
    expect(ids).toContain('claude-opus-4');
    expect(ids).toContain('claude-haiku-4');
    expect(cap.egress).toBe('cloud');
  });

  it('detects OpenAI when OPENAI_API_KEY is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-xxx';
    const cap = await getLocalCapabilities();
    const ids = cap.models.map((m) => m.id);
    expect(ids).toContain('gpt-5-codex');
    expect(cap.models.find((m) => m.id === 'gpt-5-codex')?.strengths).toContain('code');
  });

  it('Gemini detection uses GEMINI_API_KEY or GOOGLE_API_KEY', async () => {
    process.env.GOOGLE_API_KEY = 'gxxx';
    const cap = await getLocalCapabilities();
    expect(cap.models.some((m) => m.provider === 'gemini')).toBe(true);
  });

  it('aggregates several providers when multiple keys are set', async () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.OPENAI_API_KEY = 'o';
    process.env.MISTRAL_API_KEY = 'm';
    const cap = await getLocalCapabilities();
    const providers = new Set(cap.models.map((m) => m.provider));
    expect(providers.has('anthropic')).toBe(true);
    expect(providers.has('openai')).toBe(true);
    expect(providers.has('mistral')).toBe(true);
  });

  it('respects CODEBUDDY_FLEET_HOSTNAME override for machineLabel', async () => {
    process.env.CODEBUDDY_FLEET_HOSTNAME = 'darkstar';
    const cap = await getLocalCapabilities();
    expect(cap.machineLabel).toBe('darkstar');
  });

  it('parses machineSpec from CODEBUDDY_FLEET_GPU + CODEBUDDY_FLEET_RAM_GB', async () => {
    process.env.CODEBUDDY_FLEET_GPU = 'RTX 3090 ×2';
    process.env.CODEBUDDY_FLEET_RAM_GB = '128';
    const cap = await getLocalCapabilities();
    expect(cap.machineSpec?.gpu).toBe('RTX 3090 ×2');
    expect(cap.machineSpec?.ramGb).toBe(128);
  });

  it('respects CODEBUDDY_FLEET_MAX_CONCURRENCY', async () => {
    process.env.CODEBUDDY_FLEET_MAX_CONCURRENCY = '8';
    const cap = await getLocalCapabilities();
    expect(cap.maxConcurrency).toBe(8);
  });
});

describe('capability-registry — Ollama probe', () => {
  it('adds local Ollama models when /api/tags responds', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/tags')) {
        return new Response(
          JSON.stringify({
            models: [
              { name: 'qwen3.6:35b-a3b-q4_K_M' },
              { name: 'gemma4:26b' },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error('econn');
    }) as unknown as typeof fetch;

    const cap = await getLocalCapabilities();
    const ids = cap.models.map((m) => m.id);
    expect(ids).toContain('qwen3.6:35b-a3b-q4_K_M');
    expect(ids).toContain('gemma4:26b');
    expect(cap.models.find((m) => m.id.startsWith('qwen3.6'))?.provider).toBe('ollama');
    expect(cap.egress).toBe('local'); // no cloud key set
  });

  it('marks egress as cloud when both Ollama and an Anthropic key are present', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/tags')) {
        return new Response(JSON.stringify({ models: [{ name: 'gemma4:26b' }] }), {
          status: 200,
        });
      }
      throw new Error('econn');
    }) as unknown as typeof fetch;

    const cap = await getLocalCapabilities();
    expect(cap.egress).toBe('cloud');
    expect(cap.models.some((m) => m.provider === 'ollama')).toBe(true);
    expect(cap.models.some((m) => m.provider === 'anthropic')).toBe(true);
  });

  it('survives an Ollama probe error and returns empty models gracefully', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const cap = await getLocalCapabilities();
    expect(cap.models).toEqual([]);
    expect(cap.egress).toBe('local');
  });
});

describe('capability-registry — strength derivation', () => {
  it('marks Codex / coder models with the "code" strength', async () => {
    process.env.OPENAI_API_KEY = 'k';
    const cap = await getLocalCapabilities();
    const codex = cap.models.find((m) => m.id === 'gpt-5-codex');
    expect(codex?.strengths).toContain('code');
  });

  it('marks Haiku/mini/gemma as cheap + fast', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    process.env.OPENAI_API_KEY = 'k';
    const cap = await getLocalCapabilities();
    const haiku = cap.models.find((m) => m.id === 'claude-haiku-4');
    const mini = cap.models.find((m) => m.id === 'gpt-5-mini');
    expect(haiku?.strengths).toContain('cheap');
    expect(haiku?.strengths).toContain('fast');
    expect(mini?.strengths).toContain('cheap');
  });
});

describe('capability-registry — caching', () => {
  it('caches the snapshot — second call does not re-probe', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const fetchSpy = vi.fn(async () => {
      throw new Error('econn');
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await getLocalCapabilities();
    const callsAfterFirst = fetchSpy.mock.calls.length;
    await getLocalCapabilities();
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('force=true bypasses the cache', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const fetchSpy = vi.fn(async () => {
      throw new Error('econn');
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await getLocalCapabilities();
    const callsAfterFirst = fetchSpy.mock.calls.length;
    await getLocalCapabilities({ force: true });
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
