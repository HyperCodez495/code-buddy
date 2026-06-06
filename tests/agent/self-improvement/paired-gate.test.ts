import { describe, expect, it, vi } from 'vitest';

import {
  regularizedBeta,
  pairedBayesianDecision,
  runPairedGate,
  type AgentRunner,
  type GradedTask,
} from '../../../src/agent/self-improvement/paired-gate.js';

describe('regularizedBeta (incomplete beta)', () => {
  it('matches known closed-form values', () => {
    expect(regularizedBeta(1, 1, 0.5)).toBeCloseTo(0.5, 6); // uniform
    expect(regularizedBeta(2, 1, 0.5)).toBeCloseTo(0.25, 6); // I_x(a,1)=x^a
    expect(regularizedBeta(1, 2, 0.5)).toBeCloseTo(0.75, 6); // 1-(1-x)^b
    expect(regularizedBeta(5, 1, 0.5)).toBeCloseTo(0.03125, 6); // 0.5^5
  });
});

describe('pairedBayesianDecision (Bayesian sign test)', () => {
  it('needs ~4 clean wins for 95% confidence', () => {
    expect(pairedBayesianDecision(3, 0).decision).toBe('undecided'); // P=0.9375
    expect(pairedBayesianDecision(4, 0).decision).toBe('accept'); // P=0.969
    expect(pairedBayesianDecision(4, 0).pImprove).toBeCloseTo(0.96875, 4);
  });
  it('rejects on clean losses and is undecided on a wash or no data', () => {
    expect(pairedBayesianDecision(0, 4).decision).toBe('reject');
    expect(pairedBayesianDecision(2, 2).decision).toBe('undecided');
    expect(pairedBayesianDecision(0, 0).decision).toBe('undecided');
  });
});

function runner(behavior: (prompt: string, lessonText: string | null) => string): AgentRunner {
  return { run: async (prompt, lessonText) => ({ text: behavior(prompt, lessonText) }) };
}

function tasks(n: number, grade: (text: string) => boolean): GradedTask[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    prompt: `task ${i}`,
    grade: (r) => grade(r.text),
  }));
}

describe('runPairedGate (paired live gate)', () => {
  it('ACCEPTS a lesson that makes the agent solve tasks it otherwise fails', async () => {
    // With the lesson → PASS; without → FAIL → a win on every task.
    const r = runner((_p, lesson) => (lesson?.includes('use-the-tool') ? 'PASS' : 'FAIL'));
    const result = await runPairedGate('always use-the-tool first', tasks(6, (t) => t === 'PASS'), r);
    expect(result.accepted).toBe(true);
    expect(result.decision.decision).toBe('accept');
    // anytime stopping: confident after 4 clean wins, doesn't run all 6.
    expect(result.tasksRun).toBe(4);
  });

  it('REJECTS an inert lesson (changes no behavior) via ablation', async () => {
    const r = runner(() => 'PASS'); // ignores the lesson entirely
    const result = await runPairedGate('some lesson', tasks(5, (t) => t === 'PASS'), r);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe('inert');
  });

  it('hard-REJECTS a lesson that regresses a safety task', async () => {
    const safetyTasks: GradedTask[] = [
      { id: 'safe-1', prompt: 'do it safely', safety: true, grade: (r) => r.text === 'SAFE' },
      ...tasks(4, (t) => t === 'PASS'),
    ];
    // Without the lesson the agent is SAFE; with it, it goes UNSAFE.
    const r = runner((_p, lesson) => (lesson ? 'UNSAFE' : 'SAFE'));
    const result = await runPairedGate('a harmful lesson', safetyTasks, r);
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe('safety-regression');
  });

  it('does not accept a lesson with a mixed/inconclusive effect', async () => {
    // Helps the first two tasks, hurts the next two → 2 win / 2 loss → undecided.
    const r = runner((prompt, lesson) => {
      const idx = Number(prompt.split(' ')[1]);
      if (idx < 2) return lesson ? 'PASS' : 'FAIL'; // win
      return lesson ? 'FAIL' : 'PASS'; // loss
    });
    const result = await runPairedGate('mixed lesson', tasks(4, (t) => t === 'PASS'), r, { earlyStop: false });
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe('not-confident');
    expect(result.changedAny).toBe(true);
  });

  it('runs both arms per task (the lesson is the only delta)', async () => {
    const run = vi.fn(async (_p: string, _l: string | null) => ({ text: 'PASS' }));
    await runPairedGate('x', tasks(2, () => true), { run });
    expect(run).toHaveBeenCalledTimes(4); // 2 tasks × 2 arms
  });
});
