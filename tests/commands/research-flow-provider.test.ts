/**
 * Provider resolution for `buddy research` / `buddy flow` — the shared
 * resolver must keep the legacy paid-key path first, but fall back to
 * env detection (local Ollama, $0) instead of exiting, and let
 * CODEBUDDY_PROVIDER express explicit operator intent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settingsState = vi.hoisted(() => ({
  provider: 'grok' as string | undefined,
  model: undefined as string | undefined,
}));

vi.mock('../../src/utils/settings-manager.js', () => ({
  getSettingsManager: () => ({
    loadUserSettings: () => ({ provider: settingsState.provider }),
    getCurrentModel: () => settingsState.model,
  }),
}));

import { resolveCommandProvider } from '../../src/commands/llm-provider-resolution';

const PROVIDER_ENV_KEYS = [
  'CODEBUDDY_PROVIDER',
  'OLLAMA_HOST',
  'GROK_API_KEY',
  'XAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GROK_BASE_URL',
  'GROK_MODEL',
  'OLLAMA_MODEL',
  'CHATGPT_MODEL',
  'MISTRAL_API_KEY',
];

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of PROVIDER_ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  // Keep the chatgpt-oauth branch of detectProviderFromEnv inert even if
  // this machine has a codex-auth.json: only exercised when CODEBUDDY_PROVIDER
  // is unset AND no other branch matches first — our tests always set an
  // explicit provider or an API key, so ordering keeps this deterministic.
  settingsState.provider = 'grok';
  settingsState.model = undefined;
});

afterEach(() => {
  for (const key of PROVIDER_ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('resolveCommandProvider', () => {
  it('keeps the legacy paid-key path first (backward compatible)', () => {
    process.env.GROK_API_KEY = 'xai-test-key';
    settingsState.model = 'grok-4';

    const resolved = resolveCommandProvider();

    expect(resolved).not.toBeNull();
    expect(resolved!.apiKey).toBe('xai-test-key');
    expect(resolved!.model).toBe('grok-4');
  });

  it('falls back to local Ollama instead of failing when no paid key exists', () => {
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    process.env.OLLAMA_HOST = 'http://localhost:11434';

    const resolved = resolveCommandProvider();

    expect(resolved).not.toBeNull();
    expect(resolved!.apiKey).toBe('ollama');
    expect(resolved!.baseURL).toBe('http://localhost:11434/v1');
    expect(resolved!.providerLabel).toBe('ollama');
  });

  it('CODEBUDDY_PROVIDER expresses operator intent: ollama wins even when a paid key exists', () => {
    process.env.GROK_API_KEY = 'xai-test-key';
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    process.env.OLLAMA_HOST = 'http://darkstar:11434';

    const resolved = resolveCommandProvider();

    expect(resolved!.apiKey).toBe('ollama');
    expect(resolved!.baseURL).toBe('http://darkstar:11434/v1');
  });

  it('an explicit --model override wins on both paths', () => {
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    expect(resolveCommandProvider({ explicitModel: 'qwen3.6:27b' })!.model).toBe('qwen3.6:27b');

    delete process.env.CODEBUDDY_PROVIDER;
    delete process.env.OLLAMA_HOST;
    process.env.GROK_API_KEY = 'xai-test-key';
    settingsState.model = 'grok-4';
    expect(resolveCommandProvider({ explicitModel: 'grok-4-mini' })!.model).toBe('grok-4-mini');
  });

  it('the detected path ignores the settings model (a paid default would 404 on Ollama)', () => {
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    process.env.OLLAMA_MODEL = 'qwen2.5:7b-instruct';
    settingsState.model = 'gpt-5.5';

    const resolved = resolveCommandProvider();

    expect(resolved!.model).toBe('qwen2.5:7b-instruct');
  });
});

describe('research --wide gate', () => {
  it('the research command exposes --wide and --model options', async () => {
    const { createResearchCommand } = await import('../../src/commands/research/index');
    const cmd = createResearchCommand();
    const optionNames = cmd.options.map((o) => o.long);

    expect(optionNames).toContain('--wide');
    expect(optionNames).toContain('--model');
  });

  it('the flow command exposes --model', async () => {
    const { createFlowCommand } = await import('../../src/commands/flow');
    const cmd = createFlowCommand();
    const optionNames = cmd.options.map((o) => o.long);

    expect(optionNames).toContain('--model');
  });
});
