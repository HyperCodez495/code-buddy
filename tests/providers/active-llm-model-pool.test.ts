/**
 * Active-LLM model pool — multiple models per ACTIVE provider.
 *
 * The registry stays one-model-per-provider (failover/`buddy llm` contract);
 * the pool expands cloud providers to their catalog models and local runtimes
 * to their installed models, inheriting the resolved auth.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const buildActiveLlmRegistry = vi.fn();
vi.mock('../../src/providers/active-llm-registry.js', () => ({
  buildActiveLlmRegistry: (...args: unknown[]) => buildActiveLlmRegistry(...args),
}));

const findRuntimeProvider = vi.fn();
vi.mock('../../src/providers/provider-catalog.js', () => ({
  findRuntimeProvider: (...args: unknown[]) => findRuntimeProvider(...args),
}));

const getLocalCapabilities = vi.fn();
vi.mock('../../src/fleet/capability-registry.js', () => ({
  getLocalCapabilities: (...args: unknown[]) => getLocalCapabilities(...args),
}));

import { listActiveLlmModelPool } from '../../src/providers/active-llm-model-pool.js';

function active(over: Record<string, unknown>): Record<string, unknown> {
  return {
    provider: 'grok',
    model: 'grok-4-latest',
    apiKey: 'k-grok',
    baseURL: 'https://api.x.ai/v1',
    costInputUsdPerMtok: 0.5,
    isLocal: false,
    ...over,
  };
}

beforeEach(() => {
  buildActiveLlmRegistry.mockReset();
  findRuntimeProvider.mockReset();
  getLocalCapabilities.mockReset();
  findRuntimeProvider.mockReturnValue(undefined);
  getLocalCapabilities.mockResolvedValue({ models: [] });
});

describe('listActiveLlmModelPool — cloud expansion', () => {
  it('expands an active cloud provider to its catalog models, resolved default first, auth inherited', async () => {
    buildActiveLlmRegistry.mockResolvedValue({ all: [active({})] });
    findRuntimeProvider.mockReturnValue({ models: ['grok-4-1-fast', 'grok-3-mini'] });

    const pool = await listActiveLlmModelPool({ env: {} });

    expect(pool.map((p) => p.model)).toEqual(['grok-4-latest', 'grok-4-1-fast', 'grok-3-mini']);
    for (const entry of pool) {
      expect(entry.provider).toBe('grok');
      expect(entry.apiKey).toBe('k-grok');
      expect(entry.baseURL).toBe('https://api.x.ai/v1');
      expect(entry.costInputUsdPerMtok).toBe(0.5);
    }
  });

  it('dedups provider:model when the resolved default is also in the catalog list', async () => {
    buildActiveLlmRegistry.mockResolvedValue({ all: [active({ model: 'grok-4-1-fast' })] });
    findRuntimeProvider.mockReturnValue({ models: ['grok-4-1-fast', 'grok-3-mini'] });

    const pool = await listActiveLlmModelPool({ env: {} });
    expect(pool.map((p) => p.model)).toEqual(['grok-4-1-fast', 'grok-3-mini']);
  });

  it('returns an empty pool when no provider is active', async () => {
    buildActiveLlmRegistry.mockResolvedValue({ all: [] });
    expect(await listActiveLlmModelPool({ env: {} })).toEqual([]);
  });
});

describe('listActiveLlmModelPool — local expansion', () => {
  it('expands local runtimes to their installed models, deduping bare names with Ollama preferred', async () => {
    buildActiveLlmRegistry.mockResolvedValue({
      all: [
        active({ provider: 'lmstudio', model: 'meta-llama-3.1-8b-instruct', isLocal: true, apiKey: 'lmstudio', baseURL: 'http://localhost:1234/v1', costInputUsdPerMtok: 0 }),
        active({ provider: 'ollama', model: 'qwen3:8b', isLocal: true, apiKey: 'ollama', baseURL: 'http://localhost:11434/v1', costInputUsdPerMtok: 0 }),
      ],
    });
    getLocalCapabilities.mockResolvedValue({
      models: [
        { id: 'qwen3:8b', provider: 'ollama' },
        { id: 'gemma4:12b', provider: 'ollama' },
        { id: 'qwen3:8b', provider: 'lm-studio' }, // duplicate name via LM Studio → dropped
      ],
    });

    const pool = await listActiveLlmModelPool({ env: {} });

    const ollama = pool.filter((p) => p.provider === 'ollama').map((p) => p.model);
    const lmstudio = pool.filter((p) => p.provider === 'lmstudio').map((p) => p.model);
    expect(ollama).toEqual(['qwen3:8b', 'gemma4:12b']);
    expect(lmstudio).toEqual(['meta-llama-3.1-8b-instruct']);
  });

  it('caps probed local models per runtime', async () => {
    buildActiveLlmRegistry.mockResolvedValue({
      all: [active({ provider: 'ollama', model: 'm0', isLocal: true, apiKey: 'ollama', costInputUsdPerMtok: 0 })],
    });
    getLocalCapabilities.mockResolvedValue({
      models: Array.from({ length: 25 }, (_, i) => ({ id: `m${i}`, provider: 'ollama' })),
    });

    const pool = await listActiveLlmModelPool({ env: {}, maxLocalPerProvider: 3 });
    expect(pool).toHaveLength(3);
    expect(pool[0]!.model).toBe('m0'); // registry default always seats first
  });

  it('survives a failing local probe (cloud pool unaffected)', async () => {
    buildActiveLlmRegistry.mockResolvedValue({
      all: [active({}), active({ provider: 'ollama', model: 'qwen3:8b', isLocal: true, costInputUsdPerMtok: 0 })],
    });
    findRuntimeProvider.mockReturnValue({ models: ['grok-3-mini'] });
    getLocalCapabilities.mockRejectedValue(new Error('probe down'));

    const pool = await listActiveLlmModelPool({ env: {} });
    expect(pool.map((p) => p.model)).toEqual(['grok-4-latest', 'grok-3-mini', 'qwen3:8b']);
  });
});

describe('listActiveLlmModelPool — kill-switch', () => {
  it('CODEBUDDY_COUNCIL_POOL=registry reproduces the legacy one-model-per-provider set', async () => {
    buildActiveLlmRegistry.mockResolvedValue({
      all: [active({}), active({ provider: 'ollama', model: 'qwen3:8b', isLocal: true, costInputUsdPerMtok: 0 })],
    });
    findRuntimeProvider.mockReturnValue({ models: ['grok-4-1-fast'] });

    const pool = await listActiveLlmModelPool({ env: { CODEBUDDY_COUNCIL_POOL: 'registry' } });
    expect(pool.map((p) => `${p.provider}:${p.model}`)).toEqual(['grok:grok-4-latest', 'ollama:qwen3:8b']);
    expect(findRuntimeProvider).not.toHaveBeenCalled();
  });
});
