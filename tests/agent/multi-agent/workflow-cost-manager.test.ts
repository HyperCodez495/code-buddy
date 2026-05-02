/**
 * Phase L (V0.4) — WorkflowCostManager unit tests.
 *
 * Validates the cost accumulator's 3 main paths:
 *   1. Pre-task estimate (used for warning trigger only)
 *   2. Post-task record (exact if costUsd present, else estimation fallback)
 *   3. Hard cap on EXACT cumulative cost
 *
 * No real CostTracker dependency — the manager has a sync fallback for the
 * pricing table, which keeps tests deterministic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowCostManager } from '../../../src/agent/multi-agent/workflow-cost-manager.js';
import type { AgentExecutionResult } from '../../../src/agent/multi-agent/types.js';

function fakeResult(overrides: Partial<AgentExecutionResult> = {}): AgentExecutionResult {
  return {
    success: true,
    role: 'coder',
    taskId: 't1',
    output: '',
    artifacts: [],
    toolsUsed: [],
    rounds: 2,
    duration: 1000,
    ...overrides,
  };
}

describe('WorkflowCostManager (Phase L V0.4)', () => {
  let mgr: WorkflowCostManager;

  beforeEach(() => {
    mgr = new WorkflowCostManager({
      maxWorkflowCostUsd: 1.0,
      warningThresholdPercent: 0.8,
      gracefulOverflow: true,
    });
  });

  it('estimateTaskCost returns positive USD value for each role', () => {
    expect(mgr.estimateTaskCost('orchestrator', 1, 'grok-3-fast')).toBeGreaterThan(0);
    expect(mgr.estimateTaskCost('coder', 2, 'grok-3-fast')).toBeGreaterThan(0);
    expect(mgr.estimateTaskCost('reviewer', 1, 'grok-3-fast')).toBeGreaterThan(0);
    expect(mgr.estimateTaskCost('tester', 1, 'grok-3-fast')).toBeGreaterThan(0);
  });

  it('estimateTaskCost: coder more expensive than tester for same rounds', () => {
    const coder = mgr.estimateTaskCost('coder', 1, 'grok-3-fast');
    const tester = mgr.estimateTaskCost('tester', 1, 'grok-3-fast');
    expect(coder).toBeGreaterThan(tester);
  });

  it('estimateTaskCost: more rounds = more cost (linear)', () => {
    const one = mgr.estimateTaskCost('coder', 1, 'grok-3-fast');
    const five = mgr.estimateTaskCost('coder', 5, 'grok-3-fast');
    expect(five).toBeGreaterThan(one * 4); // ~5x but with min(1, rounds) floor
  });

  it('recordExact uses result.costUsd when present (exact path)', async () => {
    const cost = await mgr.recordExact(fakeResult({ costUsd: 0.42 }), 'grok-3-fast', 2);
    expect(cost).toBe(0.42);
    expect(mgr.getMetrics().totalUsd).toBe(0.42);
  });

  it('recordExact uses inputTokens+outputTokens when costUsd absent', async () => {
    const cost = await mgr.recordExact(
      fakeResult({ inputTokens: 1000, outputTokens: 500 }),
      'grok-3-fast',
      2
    );
    // grok-3-fast: input $0.0006/1k, output $0.004/1k
    // 1000 input × 0.0006/1000 + 500 output × 0.004/1000 = 0.0006 + 0.002 = 0.0026
    expect(cost).toBeCloseTo(0.0026, 4);
  });

  it('recordExact falls back to estimation when no token counts (no exact)', async () => {
    const cost = await mgr.recordExact(fakeResult({ rounds: 2 }), 'grok-3-fast', 2);
    expect(cost).toBeGreaterThan(0); // estimation fallback fires
  });

  it('multiple recordExact accumulates totalUsd', async () => {
    await mgr.recordExact(fakeResult({ costUsd: 0.1 }), 'grok-3-fast', 2);
    await mgr.recordExact(fakeResult({ costUsd: 0.2 }), 'grok-3-fast', 2);
    await mgr.recordExact(fakeResult({ costUsd: 0.3 }), 'grok-3-fast', 2);
    expect(mgr.getMetrics().totalUsd).toBeCloseTo(0.6, 4);
  });

  it('recordExact populates per-role breakdown', async () => {
    await mgr.recordExact(fakeResult({ role: 'coder', costUsd: 0.5 }), 'grok-3-fast', 2);
    await mgr.recordExact(fakeResult({ role: 'reviewer', costUsd: 0.3 }), 'grok-3-fast', 2);
    await mgr.recordExact(fakeResult({ role: 'coder', costUsd: 0.2 }), 'grok-3-fast', 2);
    const m = mgr.getMetrics();
    expect(m.perRole.get('coder')).toBeCloseTo(0.7, 4);
    expect(m.perRole.get('reviewer')).toBeCloseTo(0.3, 4);
  });

  it('isCapExceeded returns false until exact cumulative > cap', async () => {
    await mgr.recordExact(fakeResult({ costUsd: 0.5 }), 'grok-3-fast', 2);
    expect(mgr.isCapExceeded()).toBe(false);
    await mgr.recordExact(fakeResult({ costUsd: 0.4 }), 'grok-3-fast', 2);
    expect(mgr.isCapExceeded()).toBe(false); // total 0.9 < cap 1.0
    await mgr.recordExact(fakeResult({ costUsd: 0.2 }), 'grok-3-fast', 2);
    expect(mgr.isCapExceeded()).toBe(true); // total 1.1 > cap 1.0
  });

  it('checkWarning returns null when below threshold', async () => {
    await mgr.recordExact(fakeResult({ costUsd: 0.3 }), 'grok-3-fast', 2);
    // Threshold = 0.8 * 1.0 = 0.8. Adding 0.1 → projected 0.4. No warn.
    expect(mgr.checkWarning(0.1)).toBeNull();
  });

  it('checkWarning returns string when projected ≥ threshold', async () => {
    await mgr.recordExact(fakeResult({ costUsd: 0.7 }), 'grok-3-fast', 2);
    // Adding 0.2 → projected 0.9 > threshold 0.8
    const warning = mgr.checkWarning(0.2);
    expect(warning).not.toBeNull();
    expect(warning).toContain('warning threshold');
  });

  it('checkWarning is idempotent (only fires once per workflow)', async () => {
    await mgr.recordExact(fakeResult({ costUsd: 0.7 }), 'grok-3-fast', 2);
    expect(mgr.checkWarning(0.2)).not.toBeNull();
    expect(mgr.checkWarning(0.5)).toBeNull(); // already warned
  });

  it('cap = 0 (default disabled) → never triggers warning or cap', async () => {
    const noCapMgr = new WorkflowCostManager({ maxWorkflowCostUsd: 0 });
    await noCapMgr.recordExact(fakeResult({ costUsd: 9999 }), 'grok-3-fast', 2);
    expect(noCapMgr.isCapExceeded()).toBe(false);
    expect(noCapMgr.checkWarning(9999)).toBeNull();
    // But still tracks
    expect(noCapMgr.getMetrics().totalUsd).toBe(9999);
  });

  it('reset clears accumulators', async () => {
    await mgr.recordExact(fakeResult({ costUsd: 0.5, role: 'coder' }), 'grok-3-fast', 2);
    expect(mgr.getMetrics().totalUsd).toBe(0.5);
    mgr.reset();
    const m = mgr.getMetrics();
    expect(m.totalUsd).toBe(0);
    expect(m.perRole.size).toBe(0);
    expect(m.taskCount).toBe(0);
    expect(m.exceededCap).toBe(false);
    // Warning flag also reset → can warn again
    await mgr.recordExact(fakeResult({ costUsd: 0.85 }), 'grok-3-fast', 2);
    expect(mgr.checkWarning(0)).not.toBeNull();
  });

  it('getMetrics returns isolated copy of perRole Map (defensive)', async () => {
    await mgr.recordExact(fakeResult({ costUsd: 0.5, role: 'coder' }), 'grok-3-fast', 2);
    const m1 = mgr.getMetrics();
    m1.perRole.set('reviewer', 999); // mutate the copy
    const m2 = mgr.getMetrics();
    expect(m2.perRole.has('reviewer')).toBe(false); // internal state unchanged
  });
});
