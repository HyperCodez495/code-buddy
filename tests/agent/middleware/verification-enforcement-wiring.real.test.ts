/**
 * REAL (no-mock) integration test: VerificationEnforcementMiddleware wired into a
 * real MiddlewarePipeline.
 *
 * The sibling `verification-enforcement.test.ts` calls the middleware DIRECTLY,
 * proving its logic. This file proves the missing piece: when registered the way
 * the agent constructor registers it (`pipeline.use(createVerificationEnforcementMiddleware())`,
 * codebuddy-agent.ts), it (a) appears in the pipeline and (b) FIRES correctly
 * through the real pipeline dispatch — priority sort + warn accumulation in
 * `runPhase` — exercising the production `countChangedFiles` history-scan path
 * (no `changedFiles` shortcut).
 *
 * No mocks: real MiddlewarePipeline, real middleware, real ChatEntry history.
 */
import { describe, it, expect } from 'vitest';
import { MiddlewarePipeline } from '../../../src/agent/middleware/pipeline.js';
import { createVerificationEnforcementMiddleware } from '../../../src/agent/middleware/verification-enforcement.js';
import { WorkflowGuardMiddleware } from '../../../src/agent/middleware/workflow-guard.js';
import type { MiddlewareContext } from '../../../src/agent/middleware/types.js';
import type { ChatEntry } from '../../../src/agent/types.js';

function fileEditEntry(filePath: string): ChatEntry {
  return {
    type: 'tool_result',
    content: 'File written successfully',
    timestamp: new Date(),
    toolCall: {
      id: `call-${filePath}`,
      type: 'function',
      function: { name: 'write_file', arguments: JSON.stringify({ path: filePath }) },
    },
  };
}

function makeContext(history: ChatEntry[]): MiddlewareContext {
  const state = new Map<string, unknown>();
  return {
    toolRound: 5,
    maxToolRounds: 50,
    sessionCost: 0.1,
    sessionCostLimit: 10,
    inputTokens: 1000,
    outputTokens: 500,
    history,
    messages: [],
    isStreaming: false,
    // NOTE: deliberately NO `changedFiles` — forces the real history-scan path.
    state,
    getState<T>(key: string): T | undefined { return state.get(key) as T | undefined; },
    setState<T>(key: string, value: T): void { state.set(key, value); },
  } as MiddlewareContext;
}

describe('VerificationEnforcementMiddleware — real pipeline wiring', () => {
  it('is registered and priority-sorted within the pipeline', () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use(new WorkflowGuardMiddleware());           // priority 45
    pipeline.use(createVerificationEnforcementMiddleware()); // priority 155
    const names = pipeline.getMiddlewareNames();
    expect(names).toContain('verification-enforcement');
    // priority sort: workflow-guard (45) before verification-enforcement (155)
    expect(names.indexOf('workflow-guard')).toBeLessThan(
      names.indexOf('verification-enforcement'),
    );
  });

  it('fires a verify warning through the real pipeline after 3 file edits (history-scan path)', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use(createVerificationEnforcementMiddleware());

    const ctx = makeContext([
      fileEditEntry('src/a.ts'),
      fileEditEntry('src/b.ts'),
      fileEditEntry('src/c.ts'),
    ]);

    const result = await pipeline.runAfterTurn(ctx);
    expect(result.action).toBe('warn');
    expect(result.message).toContain('task_verify');
  });

  it('does NOT warn when fewer than 3 files changed', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use(createVerificationEnforcementMiddleware());
    const result = await pipeline.runAfterTurn(
      makeContext([fileEditEntry('src/a.ts'), fileEditEntry('src/b.ts')]),
    );
    expect(result.action).toBe('continue');
  });
});
