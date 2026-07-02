/**
 * L2 — the middleware pipeline is built once and reused for every user task, so
 * per-task latching state (quality-gate run count, auto-repair attempts,
 * verification one-shot warning) must be cleared at the start of each task or
 * the gates silently stay off after the first task(s).
 */
import { describe, it, expect, vi } from 'vitest';
import { MiddlewarePipeline } from '../../../src/agent/middleware/pipeline.js';
import { QualityGateMiddleware } from '../../../src/agent/middleware/quality-gate-middleware.js';
import { AutoRepairMiddleware } from '../../../src/agent/middleware/auto-repair-middleware.js';
import type { ConversationMiddleware } from '../../../src/agent/middleware/types.js';

describe('MiddlewarePipeline.resetForNewTask (L2)', () => {
  it('calls reset() on every middleware that has one', () => {
    const resetSpy = vi.fn();
    const withReset: ConversationMiddleware = { name: 'a', priority: 10, reset: resetSpy };
    const withoutReset: ConversationMiddleware = { name: 'b', priority: 20 };

    const pipeline = new MiddlewarePipeline();
    pipeline.use(withReset).use(withoutReset);
    pipeline.resetForNewTask();

    expect(resetSpy).toHaveBeenCalledTimes(1);
  });

  it('clears quality-gate and auto-repair per-task counters', async () => {
    const gate = new QualityGateMiddleware();
    const repair = new AutoRepairMiddleware();
    // Force some latched state.
    (gate as unknown as { gateRunCount: number }).gateRunCount = 2;
    (repair as unknown as { repairAttempts: number }).repairAttempts = 3;

    const pipeline = new MiddlewarePipeline();
    pipeline.use(gate).use(repair);
    pipeline.resetForNewTask();

    expect(gate.getGateRunCount()).toBe(0);
    expect(repair.getAttemptCount()).toBe(0);
  });

  it('does not let a throwing reset() break the others', () => {
    const good = vi.fn();
    const boom: ConversationMiddleware = { name: 'boom', reset: () => { throw new Error('x'); } };
    const ok: ConversationMiddleware = { name: 'ok', reset: good };

    const pipeline = new MiddlewarePipeline();
    pipeline.use(boom).use(ok);

    expect(() => pipeline.resetForNewTask()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
