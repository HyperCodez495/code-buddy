/**
 * Phase d.22 — `PromptBuilder.buildForQuery()` query-aware system prompt.
 *
 * Validates the gating matrix for `promptProfile` × query complexity:
 *   - `'lite'` profile → trivial gates (minimal SP) regardless of query
 *   - `'rich'` profile → complex gates (full SP) regardless of query
 *   - `'standard'` profile → derived from `classifyQuery(message)`
 *
 * Also validates that `supportsToolCalls === false` suppresses the
 * memory + lessons + workflow directives, which would otherwise tempt
 * small Ollama models into hallucinating JSON tool calls.
 */

import { describe, it, expect, vi } from 'vitest';

// ---- mocks ----------------------------------------------------------

const promptMocks = vi.hoisted(() => ({
  getSystemPromptForModeMock: vi.fn(
    (_mode: string, _morph: boolean, _cwd: string, _custom?: string) => 'LEGACY_BODY',
  ),
  getChatOnlySystemPromptMock: vi.fn(() => 'CHAT_ONLY_BODY'),
}));

vi.mock('../../src/prompts/index.js', () => ({
  getSystemPromptForMode: promptMocks.getSystemPromptForModeMock,
  getPromptManager: () => ({ buildSystemPrompt: vi.fn(async () => 'PM_BODY') }),
  autoSelectPromptId: vi.fn(() => 'auto-id'),
  // Phase d.23: prompt-builder swaps to chat-only when supportsToolCalls=false.
  getChatOnlySystemPrompt: promptMocks.getChatOnlySystemPromptMock,
}));

const modelToolsMock = vi.hoisted(() => ({
  getModelToolConfigMock: vi.fn((_model: string) => ({
    contextWindow: 128_000,
    maxOutputTokens: 8_000,
    supportsToolCalls: true,
    promptProfile: 'standard' as const,
  })),
}));

vi.mock('../../src/config/model-tools.js', () => ({
  getModelToolConfig: modelToolsMock.getModelToolConfigMock,
}));

// ---- import under test ----------------------------------------------

import {
  PromptBuilder,
  type PromptBuilderConfig,
} from '../../src/services/prompt-builder.js';

// ---- helpers --------------------------------------------------------

function buildBuilder() {
  const cacheSystemPrompt = vi.fn();
  const promptCacheManager = {
    cacheSystemPrompt,
  } as unknown as ConstructorParameters<typeof PromptBuilder>[1];

  const persistentMemory = {
    getContextForPrompt: () => 'persistent-mem-ctx',
  } as unknown as ConstructorParameters<typeof PromptBuilder>[4];

  const config: PromptBuilderConfig = {
    yoloMode: false,
    memoryEnabled: true,
    morphEditorEnabled: false,
    cwd: '/tmp/test',
  };

  const builder = new PromptBuilder(
    config,
    promptCacheManager,
    undefined,
    undefined,
    persistentMemory,
  );
  return { builder, cacheSystemPrompt };
}

// ---- tests ----------------------------------------------------------

describe('PromptBuilder.buildForQuery() — Phase d.22 gating', () => {
  it('lite profile: trivial gates regardless of query complexity', async () => {
    modelToolsMock.getModelToolConfigMock.mockReturnValue({
      contextWindow: 32768,
      maxOutputTokens: 2048,
      supportsToolCalls: false,
      promptProfile: 'lite',
    });

    const { builder } = buildBuilder();
    const sp = await builder.buildForQuery(
      'Refactor the entire authentication module across 50 files',
      undefined,
      'qwen2.5-coder:7b',
      null,
    );

    // Memory + lessons + workflow directives must be suppressed:
    // (a) by promptProfile='lite' → trivial gates,
    // (b) by supportsToolCalls=false force-off.
    expect(sp).not.toContain('<auto_memory_directive>');
    expect(sp).not.toContain('<lessons_directive>');
    expect(sp).not.toContain('## Workflow Orchestration');
    // Writing rules ALWAYS injected on trivial too — output discipline
    // is universally useful even for greetings.
    expect(sp).toContain('<writing_rules>');
  });

  it('rich profile: complex gates regardless of query complexity', async () => {
    modelToolsMock.getModelToolConfigMock.mockReturnValue({
      contextWindow: 200000,
      maxOutputTokens: 64000,
      supportsToolCalls: true,
      promptProfile: 'rich',
    });

    const { builder } = buildBuilder();
    const sp = await builder.buildForQuery(
      'hi',
      undefined,
      'claude-opus-4-6',
      null,
    );

    // Even a trivial "hi" gets the full directive set on rich models.
    expect(sp).toContain('<auto_memory_directive>');
    expect(sp).toContain('<lessons_directive>');
    expect(sp).toContain('<writing_rules>');
  });

  it('standard profile + trivial query: minimal SP (writing rules only directive)', async () => {
    modelToolsMock.getModelToolConfigMock.mockReturnValue({
      contextWindow: 32768,
      maxOutputTokens: 4096,
      supportsToolCalls: true,
      promptProfile: 'standard',
    });

    const { builder } = buildBuilder();
    const sp = await builder.buildForQuery(
      'merci',
      undefined,
      'mistral-large',
      null,
    );

    expect(sp).not.toContain('<auto_memory_directive>');
    expect(sp).not.toContain('<lessons_directive>');
    expect(sp).toContain('<writing_rules>');
  });

  it('standard profile + complex query: full directive set', async () => {
    // Generous budget so persona/identity/etc loaded by real modules
    // don't push the SP past the truncation cutoff and chop the
    // auto_memory directive (which is positioned mid-prompt).
    modelToolsMock.getModelToolConfigMock.mockReturnValue({
      contextWindow: 200000,
      maxOutputTokens: 16000,
      supportsToolCalls: true,
      promptProfile: 'standard',
    });

    const { builder } = buildBuilder();
    const sp = await builder.buildForQuery(
      'fix the bug in src/auth/jwt.ts and add a test that covers refresh-token rotation',
      undefined,
      'mistral-large',
      null,
    );

    expect(sp).toContain('<auto_memory_directive>');
    expect(sp).toContain('<lessons_directive>');
    expect(sp).toContain('<writing_rules>');
  });

  it('supportsToolCalls=false on rich profile: still suppresses tool-mention directives', async () => {
    // Edge case: a rich-profile model that nonetheless can't call tools.
    // The supportsToolCalls flag overrides the profile-derived gates.
    modelToolsMock.getModelToolConfigMock.mockReturnValue({
      contextWindow: 200000,
      maxOutputTokens: 16000,
      supportsToolCalls: false,
      promptProfile: 'rich',
    });

    const { builder } = buildBuilder();
    const sp = await builder.buildForQuery(
      'fix the bug across the auth module',
      undefined,
      'whatever-model',
      null,
    );

    expect(sp).not.toContain('<auto_memory_directive>');
    expect(sp).not.toContain('<lessons_directive>');
    expect(sp).toContain('<writing_rules>');
  });

  it('GROK_FORCE_TOOLS bypasses the chat-only fallback for lab validation', async () => {
    const prev = process.env.GROK_FORCE_TOOLS;
    process.env.GROK_FORCE_TOOLS = 'true';
    promptMocks.getSystemPromptForModeMock.mockClear();
    promptMocks.getChatOnlySystemPromptMock.mockClear();
    try {
      modelToolsMock.getModelToolConfigMock.mockReturnValue({
        contextWindow: 200000,
        maxOutputTokens: 16000,
        supportsToolCalls: false,
        promptProfile: 'lite',
      });

      const { builder } = buildBuilder();
      const sp = await builder.buildForQuery(
        'run echo LOCAL_CHAT_ONLY_GOAL_OK',
        undefined,
        'qwen2.5-coder:7b',
        null,
      );

      expect(sp).toContain('LEGACY_BODY');
      expect(sp).not.toContain('CHAT_ONLY_BODY');
      expect(promptMocks.getSystemPromptForModeMock).toHaveBeenCalled();
      expect(promptMocks.getChatOnlySystemPromptMock).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.GROK_FORCE_TOOLS;
      else process.env.GROK_FORCE_TOOLS = prev;
    }
  });

  it('default (no profile field) = standard, classified by query', async () => {
    modelToolsMock.getModelToolConfigMock.mockReturnValue({
      contextWindow: 32768,
      maxOutputTokens: 4096,
      supportsToolCalls: true,
      // promptProfile omitted → treated as 'standard'
    });

    const { builder } = buildBuilder();
    const sp = await builder.buildForQuery(
      'hello',
      undefined,
      'no-profile-model',
      null,
    );

    // 'hello' is trivial → no memory directive
    expect(sp).not.toContain('<auto_memory_directive>');
    expect(sp).toContain('<writing_rules>');
  });

  it('lite profile produces a SHORTER prompt than rich profile for the same query', async () => {
    // Same complex query, two different profiles → lite must be smaller.
    modelToolsMock.getModelToolConfigMock.mockReturnValue({
      contextWindow: 32768,
      maxOutputTokens: 2048,
      supportsToolCalls: false,
      promptProfile: 'lite',
    });
    const { builder: liteBuilder } = buildBuilder();
    const liteSP = await liteBuilder.buildForQuery(
      'refactor the entire codebase to use functional patterns and add tests',
      undefined,
      'qwen2.5-coder:7b',
      null,
    );

    modelToolsMock.getModelToolConfigMock.mockReturnValue({
      contextWindow: 200000,
      maxOutputTokens: 64000,
      supportsToolCalls: true,
      promptProfile: 'rich',
    });
    const { builder: richBuilder } = buildBuilder();
    const richSP = await richBuilder.buildForQuery(
      'refactor the entire codebase to use functional patterns and add tests',
      undefined,
      'claude-opus-4-6',
      null,
    );

    expect(liteSP.length).toBeLessThan(richSP.length);
  });
});
