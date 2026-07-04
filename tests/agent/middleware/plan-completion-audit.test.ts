/**
 * Tests for Plan Completion Audit Middleware
 *
 * Manus "todo.md is a verification ledger" pattern: before concluding, an active
 * plan with open items must be audited (verified or explicitly skipped), not
 * declared done from memory. The middleware reads the real PLAN.md source of
 * truth, so these tests point it at a temp file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import {
  PlanCompletionAuditMiddleware,
  createPlanCompletionAuditMiddleware,
  parsePlanItems,
  defaultPlanCompletionAuditConfig,
} from '../../../src/agent/middleware/plan-completion-audit.js';
import type { MiddlewareContext } from '../../../src/agent/middleware/types.js';

// ── Helpers ────────────────────────────────────────────────────────

function makeContext(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
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
    ...overrides,
  };
}

const PLAN_HEADER = '# Execution Plan\n\n**Goal:** do the thing\n\n## Steps\n';

describe('PlanCompletionAuditMiddleware', () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-audit-'));
    planPath = path.join(tmpDir, 'PLAN.md');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  async function writePlan(body: string): Promise<void> {
    await fs.writeFile(planPath, PLAN_HEADER + body);
  }

  describe('constructor', () => {
    it('has correct name and priority', () => {
      const mw = new PlanCompletionAuditMiddleware();
      expect(mw.name).toBe('plan-completion-audit');
      expect(mw.priority).toBe(157);
    });

    it('defaults planPath to <cwd>/PLAN.md', () => {
      const mw = new PlanCompletionAuditMiddleware();
      expect(mw.getConfig().planPath).toBe(path.join(process.cwd(), 'PLAN.md'));
      expect(mw.getConfig().enabled).toBe(true);
    });
  });

  describe('afterTurn', () => {
    it('1. warns with open item titles when the plan has open items', async () => {
      await writePlan('- [ ] write the parser\n- [/] wire the middleware\n- [x] read the codebase\n');
      const mw = new PlanCompletionAuditMiddleware({ planPath });

      const result = await mw.afterTurn(makeContext());
      expect(result.action).toBe('warn');
      expect(result.message).toContain('2 unfinished');
      expect(result.message).toContain('"write the parser"');
      expect(result.message).toContain('"wire the middleware"');
      // completed item is not listed as open
      expect(result.message).not.toContain('read the codebase');
    });

    it('2. continues silently when there is no plan file at all', async () => {
      const mw = new PlanCompletionAuditMiddleware({ planPath });
      const result = await mw.afterTurn(makeContext());
      expect(result.action).toBe('continue');
      expect(result.message).toBeUndefined();
      expect(mw.hasWarnedAlready()).toBe(false);
    });

    it('3. continues silently when every plan item is resolved', async () => {
      await writePlan('- [x] step one\n- [x] step two\n- [-] step three (skipped)\n');
      const mw = new PlanCompletionAuditMiddleware({ planPath });

      const result = await mw.afterTurn(makeContext());
      expect(result.action).toBe('continue');
      expect(mw.hasWarnedAlready()).toBe(false);
    });

    it('4. warns only once per task; reset() re-arms', async () => {
      await writePlan('- [ ] still open\n');
      const mw = new PlanCompletionAuditMiddleware({ planPath });

      const first = await mw.afterTurn(makeContext());
      expect(first.action).toBe('warn');

      const second = await mw.afterTurn(makeContext());
      expect(second.action).toBe('continue');

      mw.reset();
      expect(mw.hasWarnedAlready()).toBe(false);

      const third = await mw.afterTurn(makeContext());
      expect(third.action).toBe('warn');
    });

    it('5. skipped ([-]) and completed ([x]) items are not counted as open', async () => {
      await writePlan('- [x] done\n- [-] skipped with reason\n- [ ] the only open one\n');
      const mw = new PlanCompletionAuditMiddleware({ planPath });

      const result = await mw.afterTurn(makeContext());
      expect(result.action).toBe('warn');
      expect(result.message).toContain('1 unfinished');
      expect(result.message).toContain('"the only open one"');
      expect(result.message).not.toContain('skipped with reason');
      expect(result.message).not.toContain('"done"');
    });

    it('returns continue when disabled (no I/O, no nag)', async () => {
      await writePlan('- [ ] open item\n');
      const mw = new PlanCompletionAuditMiddleware({ planPath, enabled: false });
      const result = await mw.afterTurn(makeContext());
      expect(result.action).toBe('continue');
    });

    it('truncates the quoted list and reports the remainder', async () => {
      const body = Array.from({ length: 8 }, (_, i) => `- [ ] item ${i}\n`).join('');
      await writePlan(body);
      const mw = new PlanCompletionAuditMiddleware({ planPath, maxItemsInMessage: 3 });

      const result = await mw.afterTurn(makeContext());
      expect(result.action).toBe('warn');
      expect(result.message).toContain('8 unfinished');
      expect(result.message).toContain('and 5 more');
    });

    it('fails silent on an unreadable plan path (never throws)', async () => {
      // Point at a directory — readFile will fail → treated as no open items.
      const mw = new PlanCompletionAuditMiddleware({ planPath: tmpDir });
      const result = await mw.afterTurn(makeContext());
      expect(result.action).toBe('continue');
    });
  });

  describe('parsePlanItems', () => {
    it('classifies markers into statuses and open-ness', () => {
      const items = parsePlanItems(
        '- [ ] a\n- [/] b\n- [x] c\n- [X] d\n- [-] e\n- [?] f\nnot an item\n',
      );
      expect(items).toHaveLength(6);
      expect(items.map(i => i.status)).toEqual([
        'pending', 'in_progress', 'completed', 'completed', 'failed', 'unknown',
      ]);
      expect(items.filter(i => i.open).map(i => i.text)).toEqual(['a', 'b']);
    });
  });

  describe('factory + config', () => {
    it('createPlanCompletionAuditMiddleware returns a configured instance', () => {
      const mw = createPlanCompletionAuditMiddleware({ maxItemsInMessage: 2 });
      expect(mw).toBeInstanceOf(PlanCompletionAuditMiddleware);
      expect(mw.getConfig().maxItemsInMessage).toBe(2);
    });

    it('defaultPlanCompletionAuditConfig is enabled by default', () => {
      expect(defaultPlanCompletionAuditConfig().enabled).toBe(true);
    });
  });
});
