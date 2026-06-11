import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GoalJudgeFn, GoalJudgeResult } from '../../src/goals/goal-judge.js';
import { GoalManager, resetGoalManagers } from '../../src/goals/goal-manager.js';
import { GoalStore } from '../../src/goals/goal-store.js';

function fakeJudge(...results: GoalJudgeResult[]): GoalJudgeFn {
  const queue = [...results];
  return vi.fn(async () => queue.shift() ?? results[results.length - 1]!);
}

const CONTINUE: GoalJudgeResult = { verdict: 'continue', reason: 'not yet', parseFailed: false };
const DONE: GoalJudgeResult = { verdict: 'done', reason: 'all tests pass', parseFailed: false };
const PARSE_FAIL: GoalJudgeResult = {
  verdict: 'continue',
  reason: 'judge reply was not JSON',
  parseFailed: true,
};

describe('GoalManager', () => {
  let tmpDir: string;
  let store: GoalStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-manager-test-'));
    store = new GoalStore({ storeDir: tmpDir });
    resetGoalManagers(store);
  });

  afterEach(() => {
    resetGoalManagers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('set() activates a goal with the default budget and persists it', () => {
    const mgr = new GoalManager('s1', store);
    const state = mgr.set('fix the build');
    expect(state.status).toBe('active');
    expect(state.maxTurns).toBe(20);
    expect(mgr.isActive()).toBe(true);
    expect(store.load('s1')?.goal).toBe('fix the build');
  });

  it('set() rejects empty goal text', () => {
    const mgr = new GoalManager('s1', store);
    expect(() => mgr.set('   ')).toThrow('goal text is empty');
  });

  it('marks done when the judge says done', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build');
    const decision = await mgr.evaluateAfterTurn('Build is green.', { judge: fakeJudge(DONE) });
    expect(decision.status).toBe('done');
    expect(decision.shouldContinue).toBe(false);
    expect(decision.message).toBe('✓ Goal achieved: all tests pass');
    expect(store.load('s1')?.status).toBe('done');
  });

  it('continues under budget with a continuation prompt and ↻ message', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build');
    const decision = await mgr.evaluateAfterTurn('Still failing.', { judge: fakeJudge(CONTINUE) });
    expect(decision.shouldContinue).toBe(true);
    expect(decision.continuationPrompt).toContain('Goal: fix the build');
    expect(decision.message).toBe('↻ Continuing toward goal (1/20): not yet');
  });

  it('includes subgoals in the continuation prompt and judge params', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build');
    mgr.addSubgoal('include a regression test');
    const judge = fakeJudge(CONTINUE);
    const decision = await mgr.evaluateAfterTurn('Working.', { judge });
    expect(decision.continuationPrompt).toContain('- 1. include a regression test');
    expect(judge).toHaveBeenCalledWith(
      expect.objectContaining({ subgoals: ['include a regression test'] })
    );
  });

  it('auto-pauses when the turn budget is exhausted', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build', { maxTurns: 2 });
    await mgr.evaluateAfterTurn('turn 1', { judge: fakeJudge(CONTINUE) });
    const decision = await mgr.evaluateAfterTurn('turn 2', { judge: fakeJudge(CONTINUE) });
    expect(decision.status).toBe('paused');
    expect(decision.shouldContinue).toBe(false);
    expect(decision.message).toContain('⏸ Goal paused — 2/2 turns used');
    expect(store.load('s1')?.pausedReason).toBe('turn budget exhausted (2/2)');
  });

  it('auto-pauses after 3 consecutive judge parse failures', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build');
    await mgr.evaluateAfterTurn('t1', { judge: fakeJudge(PARSE_FAIL) });
    await mgr.evaluateAfterTurn('t2', { judge: fakeJudge(PARSE_FAIL) });
    const decision = await mgr.evaluateAfterTurn('t3', { judge: fakeJudge(PARSE_FAIL) });
    expect(decision.status).toBe('paused');
    expect(decision.message).toContain("isn't returning the required JSON verdict");
    expect(decision.message).toContain('judgeModel');
  });

  it('resets the parse-failure streak on transport errors (parseFailed=false)', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build');
    await mgr.evaluateAfterTurn('t1', { judge: fakeJudge(PARSE_FAIL) });
    await mgr.evaluateAfterTurn('t2', { judge: fakeJudge(PARSE_FAIL) });
    // Transport error — does NOT count toward the 3-strike auto-pause.
    await mgr.evaluateAfterTurn('t3', {
      judge: fakeJudge({ verdict: 'continue', reason: 'judge error: Error', parseFailed: false }),
    });
    const decision = await mgr.evaluateAfterTurn('t4', { judge: fakeJudge(PARSE_FAIL) });
    expect(decision.status).toBe('active');
    expect(decision.shouldContinue).toBe(true);
  });

  it('pause/resume controls the loop; resume resets the budget', async () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build');
    await mgr.evaluateAfterTurn('t1', { judge: fakeJudge(CONTINUE) });
    expect(mgr.state?.turnsUsed).toBe(1);

    mgr.pause('user-paused');
    expect(mgr.isActive()).toBe(false);
    expect(mgr.hasGoal()).toBe(true);

    const inactive = await mgr.evaluateAfterTurn('t2', { judge: fakeJudge(DONE) });
    expect(inactive.verdict).toBe('inactive');

    const resumed = mgr.resume();
    expect(resumed?.status).toBe('active');
    expect(resumed?.turnsUsed).toBe(0);
    expect(resumed?.pausedReason).toBeUndefined();
  });

  it('clear() leaves a tombstone on disk and drops the in-memory goal', () => {
    const mgr = new GoalManager('s1', store);
    mgr.set('fix the build');
    mgr.clear();
    expect(mgr.hasGoal()).toBe(false);
    expect(mgr.statusLine()).toContain('No active goal');
    // Tombstone preserved for audit, but a new manager reads it as no goal.
    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, 's1.json'), 'utf-8'));
    expect(raw.status).toBe('cleared');
    expect(new GoalManager('s1', store).hasGoal()).toBe(false);
  });

  it('persists across manager instances on the same store (resume semantics)', async () => {
    const first = new GoalManager('s1', store);
    first.set('fix the build');
    first.addSubgoal('run lint');
    await first.evaluateAfterTurn('t1', { judge: fakeJudge(CONTINUE) });

    const second = new GoalManager('s1', store);
    expect(second.isActive()).toBe(true);
    expect(second.state?.turnsUsed).toBe(1);
    expect(second.state?.subgoals).toEqual(['run lint']);
  });

  it('manages subgoals: add, remove (1-based), clear, guards', () => {
    const mgr = new GoalManager('s1', store);
    expect(() => mgr.addSubgoal('x')).toThrow('no active goal');
    mgr.set('fix the build');
    mgr.addSubgoal('a');
    mgr.addSubgoal('b');
    expect(mgr.renderSubgoals()).toBe('- 1. a\n- 2. b');
    expect(mgr.removeSubgoal(1)).toBe('a');
    expect(() => mgr.removeSubgoal(5)).toThrow('index out of range (1..1)');
    expect(mgr.clearSubgoals()).toBe(1);
    expect(mgr.renderSubgoals()).toContain('no subgoals');
  });

  it('statusLine reflects the live state', () => {
    const mgr = new GoalManager('s1', store);
    expect(mgr.statusLine()).toBe('No active goal. Set one with /goal <text>.');
    mgr.set('fix the build');
    expect(mgr.statusLine()).toBe('⊙ Goal (active, 0/20 turns): fix the build');
  });
});
