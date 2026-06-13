import { describe, expect, it } from 'vitest';
import {
  createAuxiliaryChatOptions,
  createAuxiliaryCodeBuddyClient,
  resolveRuntimeAuxiliaryProvider,
} from '../../src/providers/auxiliary-provider.js';
import { resolveProviderFromCatalog } from '../../src/providers/provider-catalog.js';

describe('runtime auxiliary provider resolution', () => {
  it('uses the main provider for auto auxiliary tasks by default', () => {
    const mainProvider = resolveProviderFromCatalog({
      env: {
        OPENAI_API_KEY: 'main-openai-key',
        OPENAI_MODEL: 'gpt-4o-mini',
      },
      hasChatGptOAuth: false,
    });
    expect(mainProvider).not.toBeNull();

    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'compression',
      mainProvider,
      hasChatGptOAuth: false,
      env: {},
    });

    expect(resolved).toMatchObject({
      task: 'compression',
      provider: 'openai',
      providerSetting: 'auto',
      apiKey: 'main-openai-key',
      model: 'gpt-4o-mini',
      timeoutMs: 120_000,
    });
  });

  it('prefers OpenRouter for auto vision when OpenRouter is configured', () => {
    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'vision',
      hasChatGptOAuth: false,
      env: {
        OPENROUTER_API_KEY: 'openrouter-key',
      },
    });

    expect(resolved).toMatchObject({
      task: 'vision',
      provider: 'openrouter',
      apiKey: 'openrouter-key',
      model: 'google/gemini-2.5-flash',
      timeoutMs: 120_000,
    });
  });

  it('honors Hermes-style task-specific model env vars', () => {
    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'vision',
      hasChatGptOAuth: false,
      env: {
        OPENROUTER_API_KEY: 'openrouter-key',
        AUXILIARY_VISION_MODEL: 'openai/gpt-4o',
      },
    });

    expect(resolved).toMatchObject({
      provider: 'openrouter',
      model: 'openai/gpt-4o',
    });
  });

  it('resolves catalog aliases with task-specific credentials', () => {
    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'approval',
      hasChatGptOAuth: false,
      env: {
        CODEBUDDY_AUXILIARY_APPROVAL_PROVIDER: 'glm',
        CODEBUDDY_AUXILIARY_APPROVAL_API_KEY: 'glm-aux-key',
        CODEBUDDY_AUXILIARY_APPROVAL_MODEL: 'glm-5-code',
        CODEBUDDY_AUXILIARY_APPROVAL_TIMEOUT_MS: '45000',
      },
    });

    expect(resolved).toMatchObject({
      task: 'approval',
      provider: 'zai',
      providerSetting: 'glm',
      apiKey: 'glm-aux-key',
      model: 'glm-5-code',
      timeoutMs: 45_000,
    });
  });

  it('supports provider=main with per-task overrides', () => {
    const mainProvider = resolveProviderFromCatalog({
      env: {
        OPENAI_API_KEY: 'main-openai-key',
      },
      hasChatGptOAuth: false,
    });
    expect(mainProvider).not.toBeNull();

    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'web_extract',
      mainProvider,
      hasChatGptOAuth: false,
      env: {
        AUXILIARY_WEB_EXTRACT_PROVIDER: 'main',
        AUXILIARY_WEB_EXTRACT_MODEL: 'gpt-4o-mini',
        AUXILIARY_WEB_EXTRACT_TIMEOUT: '360',
      },
    });

    expect(resolved).toMatchObject({
      task: 'web_extract',
      provider: 'openai',
      providerSetting: 'main',
      model: 'gpt-4o-mini',
      timeoutMs: 360_000,
    });
  });

  it('passes per-task OpenRouter extra body through the resolved provider', () => {
    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'compression',
      hasChatGptOAuth: false,
      env: {
        CODEBUDDY_AUXILIARY_COMPRESSION_PROVIDER: 'openrouter',
        CODEBUDDY_AUXILIARY_COMPRESSION_API_KEY: 'openrouter-key',
        CODEBUDDY_AUXILIARY_COMPRESSION_MODEL: 'openrouter/pareto-code',
        CODEBUDDY_AUXILIARY_COMPRESSION_EXTRA_BODY: '{"provider":{"sort":"throughput"},"plugins":[{"id":"pareto-router"}]}',
      },
    });

    expect(resolved?.extraBody).toEqual({
      provider: { sort: 'throughput' },
      plugins: [{ id: 'pareto-router' }],
    });
  });

  it('creates a CodeBuddy client and chat options from a resolved auxiliary provider', () => {
    const resolved = resolveRuntimeAuxiliaryProvider({
      task: 'compression',
      hasChatGptOAuth: false,
      env: {
        CODEBUDDY_AUXILIARY_COMPRESSION_PROVIDER: 'openai',
        CODEBUDDY_AUXILIARY_COMPRESSION_API_KEY: 'openai-aux-key',
        CODEBUDDY_AUXILIARY_COMPRESSION_MODEL: 'gpt-4o-mini',
      },
    });
    expect(resolved).not.toBeNull();

    const client = createAuxiliaryCodeBuddyClient(resolved!);
    const options = createAuxiliaryChatOptions(resolved!, { temperature: 0.1 });

    expect(client.getCurrentModel()).toBe('gpt-4o-mini');
    expect(client.getBaseURL()).toBe('https://api.openai.com/v1');
    expect(options).toMatchObject({
      model: 'gpt-4o-mini',
      timeoutMs: 120_000,
      temperature: 0.1,
    });
  });
});
