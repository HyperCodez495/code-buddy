import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreate = vi.fn();

vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  }

  return {
    __esModule: true,
    default: MockOpenAI,
  };
});

vi.mock('../../src/utils/model-utils', () => ({
  validateModel: vi.fn(),
  getModelInfo: vi.fn().mockReturnValue({
    maxTokens: 8192,
    provider: 'xai',
    isSupported: true,
  }),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { CodeBuddyClient } from '../../src/codebuddy/client';

const openRouterRoutingEnvKeys = [
  'OPENROUTER_PROVIDER_SORT',
  'OPENROUTER_PROVIDER_ONLY',
  'OPENROUTER_PROVIDER_IGNORE',
  'OPENROUTER_PROVIDER_ORDER',
  'OPENROUTER_PROVIDER_REQUIRE_PARAMETERS',
  'OPENROUTER_PROVIDER_DATA_COLLECTION',
  'OPENROUTER_PROVIDER_ALLOW_FALLBACKS',
];

describe('CodeBuddyClient search compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of openRouterRoutingEnvKeys) {
      delete process.env[key];
    }
  });

  it('omits search_parameters for xAI provider', async () => {
    const client = new CodeBuddyClient('test-key', 'grok-code-fast-1', 'https://api.x.ai/v1');
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    });

    await client.search('hello');

    const payload = mockCreate.mock.calls[0][0];
    expect(payload.search_parameters).toBeUndefined();
  });

  it('includes search_parameters for non-xAI providers', async () => {
    const client = new CodeBuddyClient('test-key', 'gpt-4o', 'https://api.openai.com/v1');
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    });

    await client.search('hello');

    const payload = mockCreate.mock.calls[0][0];
    expect(payload.search_parameters).toEqual({ mode: 'on' });
  });

  it('passes Hermes-style OpenRouter provider routing options', async () => {
    process.env.OPENROUTER_PROVIDER_ONLY = 'Anthropic, Google';
    process.env.OPENROUTER_PROVIDER_IGNORE = 'Azure';
    process.env.OPENROUTER_PROVIDER_ORDER = 'Anthropic, Google';
    process.env.OPENROUTER_PROVIDER_SORT = 'latency';
    process.env.OPENROUTER_PROVIDER_REQUIRE_PARAMETERS = 'true';
    process.env.OPENROUTER_PROVIDER_DATA_COLLECTION = 'deny';
    process.env.OPENROUTER_PROVIDER_ALLOW_FALLBACKS = 'false';

    const client = new CodeBuddyClient('test-key', 'openai/gpt-4o', 'https://openrouter.ai/api/v1');
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    });

    await client.chat([{ role: 'user', content: 'hello' }], []);

    const payload = mockCreate.mock.calls[0][0];
    expect(payload.provider).toEqual({
      only: ['Anthropic', 'Google'],
      ignore: ['Azure'],
      order: ['Anthropic', 'Google'],
      sort: 'latency',
      data_collection: 'deny',
      require_parameters: true,
      allow_fallbacks: false,
    });
  });
});
