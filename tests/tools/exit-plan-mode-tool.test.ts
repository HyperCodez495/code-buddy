/**
 * ExitPlanMode Tool — Core Tests (V4.4)
 *
 * Tests validation, plan-mode gating, provider dispatch, mode transition
 * (approval → balanced via OperatingModeManager), and the awaiting-approval
 * flag lifecycle. Interactive readline rendering is out of scope here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  executeExitPlanMode,
  setExitPlanModeUIProvider,
  resetExitPlanModeUIProvider,
  type ExitPlanModeUIProvider,
  type ExitPlanModeInput,
  type ExitPlanModeApprovalResult,
} from '../../src/tools/exit-plan-mode-tool.js';
import {
  isAwaitingApproval,
  setApprovedPlanPath,
  resetPlanMode,
} from '../../src/agent/plan-mode.js';
import { getOperatingModeManager } from '../../src/agent/operating-modes.js';

/** Scriptable fake provider — captures the context it received and returns
 *  a scripted decision (or throws). */
class FakeUIProvider implements ExitPlanModeUIProvider {
  available = true;
  capturedCtx: { planPath: string | null; input: ExitPlanModeInput } | null = null;
  decision: ExitPlanModeApprovalResult = { approved: false };
  errorToThrow: Error | null = null;

  isAvailable(): boolean {
    return this.available;
  }
  async requestApproval(ctx: {
    planPath: string | null;
    input: ExitPlanModeInput;
  }): Promise<ExitPlanModeApprovalResult> {
    this.capturedCtx = ctx;
    if (this.errorToThrow) throw this.errorToThrow;
    return this.decision;
  }
}

describe('ExitPlanMode Core', () => {
  let provider: FakeUIProvider;

  beforeEach(() => {
    provider = new FakeUIProvider();
    setExitPlanModeUIProvider(provider);
    // Start each test in plan mode (the tool errors otherwise)
    getOperatingModeManager().setMode('plan');
  });

  afterEach(() => {
    resetExitPlanModeUIProvider();
    resetPlanMode();
    getOperatingModeManager().setMode('balanced');
  });

  describe('plan-mode gating', () => {
    it('rejects when not in plan mode', async () => {
      getOperatingModeManager().setMode('balanced');
      const result = await executeExitPlanMode({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('outside plan mode');
    });
  });

  describe('provider availability', () => {
    it('rejects when no provider is registered', async () => {
      resetExitPlanModeUIProvider();
      const result = await executeExitPlanMode({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('requires an interactive UI');
    });

    it('rejects when provider reports unavailable', async () => {
      provider.available = false;
      const result = await executeExitPlanMode({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('requires an interactive UI');
    });
  });

  describe('input validation', () => {
    it('rejects allowedPrompts items missing required fields', async () => {
      const result = await executeExitPlanMode({
        allowedPrompts: [{ tool: '', prompt: 'p' } as never],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('allowedPrompts[0].tool');
    });

    it('rejects planSummary that is not a string', async () => {
      const result = await executeExitPlanMode({
        planSummary: 123 as never,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('planSummary must be a string');
    });
  });

  describe('approval flow', () => {
    it('switches to balanced mode and returns success on approval', async () => {
      provider.decision = { approved: true };
      const result = await executeExitPlanMode({});
      expect(result.success).toBe(true);
      expect(result.output).toContain('Plan approved');
      expect(getOperatingModeManager().getMode()).toBe('balanced');
    });

    it('includes the user note in the success output when provided', async () => {
      provider.decision = { approved: true, reason: 'looks good, ship it' };
      const result = await executeExitPlanMode({});
      expect(result.success).toBe(true);
      expect(result.output).toContain('looks good, ship it');
    });

    it('keeps plan mode active and returns error on rejection', async () => {
      provider.decision = { approved: false, reason: 'needs more research' };
      const result = await executeExitPlanMode({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Plan rejected');
      expect(result.error).toContain('needs more research');
      expect(getOperatingModeManager().getMode()).toBe('plan');
    });
  });

  describe('plan path lookup', () => {
    it('forwards the registered plan path to the provider', async () => {
      setApprovedPlanPath('.codebuddy/plans/current.md');
      provider.decision = { approved: true };
      await executeExitPlanMode({});
      expect(provider.capturedCtx?.planPath).toBe('.codebuddy/plans/current.md');
    });

    it('passes null planPath when none is registered', async () => {
      provider.decision = { approved: true };
      await executeExitPlanMode({});
      expect(provider.capturedCtx?.planPath).toBeNull();
    });
  });

  describe('awaiting-approval flag lifecycle', () => {
    it('clears awaiting flag after approval', async () => {
      provider.decision = { approved: true };
      await executeExitPlanMode({});
      expect(isAwaitingApproval()).toBe(false);
    });

    it('clears awaiting flag after rejection', async () => {
      provider.decision = { approved: false };
      await executeExitPlanMode({});
      expect(isAwaitingApproval()).toBe(false);
    });

    it('clears awaiting flag even when provider throws', async () => {
      provider.errorToThrow = new Error('boom');
      const result = await executeExitPlanMode({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('boom');
      expect(isAwaitingApproval()).toBe(false);
    });
  });
});
