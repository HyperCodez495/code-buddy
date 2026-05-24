/**
 * GAP-1 — per-turn user-model injection.
 *
 * `injectInitialContext` (round 0) and `injectNextRoundContext` (rounds ≥1) are
 * the single source of truth that BOTH agent-executor paths call once per turn
 * (the executor test pins that both paths invoke them). These tests pin the
 * actual injection contract: the `<user_model_context>` block appears exactly
 * once when the model has an accepted-observation summary, and not at all when
 * the model is empty or the feature flag is off.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';
import type { ContextInjectionLevel, QueryComplexity } from '../../../src/agent/execution/query-classifier.js';

const { summarizeMock, isFeatureEnabledMock } = vi.hoisted(() => ({
  summarizeMock: vi.fn<[], string | null>(),
  isFeatureEnabledMock: vi.fn<[string], boolean>(),
}));

vi.mock('../../../src/memory/user-model.js', () => ({
  getUserModel: () => ({ summarize: summarizeMock }),
}));
vi.mock('../../../src/config/feature-flags.js', () => ({
  isFeatureEnabled: isFeatureEnabledMock,
}));
// Keep the other per-turn injections inert so we isolate the user-model block.
vi.mock('../../../src/agent/lessons-tracker.js', () => ({
  getLessonsTracker: () => ({ buildContextBlock: () => null }),
}));
vi.mock('../../../src/agent/todo-tracker.js', () => ({
  getTodoTracker: () => ({ buildContextSuffix: () => null }),
}));

import {
  injectInitialContext,
  injectNextRoundContext,
  type InitialContextDeps,
} from '../../../src/agent/execution/context-pipeline.js';

const NO_CONTEXT: ContextInjectionLevel = {
  workspace: false,
  lessons: false,
  knowledgeGraph: false,
  decisionMemory: false,
  icmMemory: false,
  codeGraph: false,
  docs: false,
  todo: false,
};

function initialDeps(): InitialContextDeps {
  return {
    message: 'rename a variable across files',
    cwd: '/tmp/gap1',
    ctxLevel: NO_CONTEXT,
    loadWorkspaceContext: async () => '',
    decisionContextProvider: null,
    icmBridgeProvider: null,
    codeGraphContextProvider: null,
  };
}

function countUserModelBlocks(messages: CodeBuddyMessage[]): number {
  return messages.filter(
    (m) => typeof m.content === 'string' && m.content.includes('<user_model_context>'),
  ).length;
}

describe('context-pipeline user-model injection (GAP-1)', () => {
  beforeEach(() => {
    summarizeMock.mockReset();
    isFeatureEnabledMock.mockReset();
  });

  describe('injectInitialContext (round 0)', () => {
    it('injects <user_model_context> exactly once when the model has accepted observations', async () => {
      isFeatureEnabledMock.mockReturnValue(true);
      summarizeMock.mockReturnValue('Prefers French; writes ESM with .js import extensions.');

      const messages: CodeBuddyMessage[] = [];
      await injectInitialContext(messages, initialDeps());

      expect(countUserModelBlocks(messages)).toBe(1);
      const block = messages.find((m) => String(m.content).includes('<user_model_context>'))!;
      expect(block.role).toBe('system');
      expect(block.content).toContain('Prefers French');
      expect(block.content).toContain('</user_model_context>');
    });

    it('injects nothing when the user model is empty (summarize → null)', async () => {
      isFeatureEnabledMock.mockReturnValue(true);
      summarizeMock.mockReturnValue(null);

      const messages: CodeBuddyMessage[] = [];
      await injectInitialContext(messages, initialDeps());

      expect(countUserModelBlocks(messages)).toBe(0);
    });

    it('injects nothing when the USER_MODEL_INJECTION flag is off', async () => {
      isFeatureEnabledMock.mockReturnValue(false);
      summarizeMock.mockReturnValue('Should never be read because the flag is off.');

      const messages: CodeBuddyMessage[] = [];
      await injectInitialContext(messages, initialDeps());

      expect(countUserModelBlocks(messages)).toBe(0);
      expect(summarizeMock).not.toHaveBeenCalled();
    });
  });

  describe('injectNextRoundContext (rounds ≥1)', () => {
    const nextDeps = {
      message: 'continue',
      cwd: '/tmp/gap1',
      queryComplexity: 'simple' as QueryComplexity,
    };

    it('re-injects <user_model_context> exactly once per round when non-empty', async () => {
      isFeatureEnabledMock.mockReturnValue(true);
      summarizeMock.mockReturnValue('Prefers conservative refactors; calls the advisor before structural steps.');

      const messages: CodeBuddyMessage[] = [];
      await injectNextRoundContext(messages, nextDeps);

      expect(countUserModelBlocks(messages)).toBe(1);
    });

    it('injects nothing on later rounds when the model is empty', async () => {
      isFeatureEnabledMock.mockReturnValue(true);
      summarizeMock.mockReturnValue(null);

      const messages: CodeBuddyMessage[] = [];
      await injectNextRoundContext(messages, nextDeps);

      expect(countUserModelBlocks(messages)).toBe(0);
    });
  });
});
