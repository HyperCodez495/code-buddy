/**
 * REAL (no-mock) integration test: PlanCompletionAuditMiddleware wired into a
 * real MiddlewarePipeline.
 *
 * The sibling `plan-completion-audit.test.ts` calls the middleware DIRECTLY. This
 * file proves the missing piece: when registered the way the agent constructor
 * registers it (`pipeline.use(createPlanCompletionAuditMiddleware())`,
 * codebuddy-agent.ts), it (a) appears in the pipeline, (b) priority-sorts after
 * verification-enforcement (155), and (c) FIRES correctly through the real
 * pipeline dispatch (priority sort + warn accumulation in `runPhase`) reading a
 * real PLAN.md on disk.
 *
 * No mocks: real MiddlewarePipeline, real middleware, real temp PLAN.md.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { MiddlewarePipeline } from '../../../src/agent/middleware/pipeline.js';
import { createPlanCompletionAuditMiddleware } from '../../../src/agent/middleware/plan-completion-audit.js';
import { createVerificationEnforcementMiddleware } from '../../../src/agent/middleware/verification-enforcement.js';
import type { MiddlewareContext } from '../../../src/agent/middleware/types.js';

function makeContext(): MiddlewareContext {
  const state = new Map<string, unknown>();
  return {
    toolRound: 5,
    maxToolRounds: 50,
    sessionCost: 0.1,
    sessionCostLimit: 10,
    inputTokens: 1000,
    outputTokens: 500,
    history: [],
    messages: [],
    isStreaming: false,
    state,
    getState<T>(key: string): T | undefined { return state.get(key) as T | undefined; },
    setState<T>(key: string, value: T): void { state.set(key, value); },
  } as MiddlewareContext;
}

describe('PlanCompletionAuditMiddleware — real pipeline wiring', () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-audit-wire-'));
    planPath = path.join(tmpDir, 'PLAN.md');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('is registered and priority-sorted after verification-enforcement', () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use(createPlanCompletionAuditMiddleware());     // priority 157
    pipeline.use(createVerificationEnforcementMiddleware()); // priority 155
    const names = pipeline.getMiddlewareNames();
    expect(names).toContain('plan-completion-audit');
    // priority sort: verification-enforcement (155) before plan-completion-audit (157)
    expect(names.indexOf('verification-enforcement')).toBeLessThan(
      names.indexOf('plan-completion-audit'),
    );
  });

  it('fires a plan-audit warning through the real pipeline when PLAN.md has open items', async () => {
    await fs.writeFile(planPath, '# Execution Plan\n\n## Steps\n- [ ] ship the feature\n- [x] read the code\n');
    const pipeline = new MiddlewarePipeline();
    pipeline.use(createPlanCompletionAuditMiddleware({ planPath }));

    const result = await pipeline.runAfterTurn(makeContext());
    expect(result.action).toBe('warn');
    expect(result.message).toContain('unfinished');
    expect(result.message).toContain('"ship the feature"');
  });

  it('does NOT warn through the pipeline when there is no active plan (zero noise)', async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use(createPlanCompletionAuditMiddleware({ planPath }));
    const result = await pipeline.runAfterTurn(makeContext());
    expect(result.action).toBe('continue');
  });

  it('resetForNewTask() re-arms the latch through the pipeline', async () => {
    await fs.writeFile(planPath, '# Execution Plan\n\n## Steps\n- [ ] still open\n');
    const pipeline = new MiddlewarePipeline();
    pipeline.use(createPlanCompletionAuditMiddleware({ planPath }));

    expect((await pipeline.runAfterTurn(makeContext())).action).toBe('warn');
    expect((await pipeline.runAfterTurn(makeContext())).action).toBe('continue');

    pipeline.resetForNewTask();
    expect((await pipeline.runAfterTurn(makeContext())).action).toBe('warn');
  });
});
