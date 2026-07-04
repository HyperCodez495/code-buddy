/**
 * AI-Scientist-lite Phase 1 — empirical decision tests.
 *
 * `scoreExperiment` REUSES `computeFitness`; `decideKeep` REUSES
 * `detectRegressions`. A variant that beats its EXPERIMENT baseline is kept; one
 * that is worse (or regressed) is rejected (rollback = not kept). No `main`, no
 * repo tests are involved — the baseline is another experiment's fitness.
 */
import { describe, it, expect } from 'vitest';

import { decideKeep, scoreExperiment } from '../../../src/agent/science/experiment-decision.js';
import {
  experimentFitnessComponent,
  stdoutNumberMetric,
} from '../../../src/agent/science/experiment-fitness.js';
import type { ExecuteCodeResult } from '../../../src/tools/execute-code-runner.js';
import type { FitnessContext, FitnessReport } from '../../../src/agent/self-improvement/evolution/variant-fitness.js';

function fakeExec(stdout: string): ExecuteCodeResult {
  return {
    kind: 'execute_code_result',
    ok: true,
    runId: 'exec-1',
    language: 'python',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    commandPreview: 'python script.py',
    runDir: '/experiments/exp-1',
    scriptPath: '/experiments/exp-1/script.py',
    stdoutPath: '/experiments/exp-1/stdout.log',
    stderrPath: '/experiments/exp-1/stderr.log',
    resultPath: '/experiments/exp-1/result.json',
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout,
    stderr: '',
    files: [],
  };
}

/** Score an experiment whose stdout prints `accuracy=<n>`. */
async function scoreAccuracy(accuracy: number, baseline?: FitnessReport): Promise<FitnessReport> {
  const component = experimentFitnessComponent({
    name: 'accuracy',
    code: `print("accuracy=${accuracy}")`,
    language: 'python',
    executeCode: async () => fakeExec(`accuracy=${accuracy}`),
    parseMetric: stdoutNumberMetric('accuracy'),
  });
  const ctx: FitnessContext = { checkoutDir: '/experiments/exp-1' };
  return scoreExperiment(ctx, [component], baseline);
}

describe('scoreExperiment (reuses computeFitness)', () => {
  it('aggregates the experiment metric into a [0,1] fitness', async () => {
    const report = await scoreAccuracy(0.9);
    expect(report.score).toBeCloseTo(0.9);
    expect(report.passedAll).toBe(true);
    expect(report.components[0]!.name).toBe('accuracy');
  });

  it('flags a regression vs an experiment baseline (reuses detectRegressions)', async () => {
    const baseline = await scoreAccuracy(0.9);
    const worse = await scoreAccuracy(0.6, baseline);
    expect(worse.regressions).toContain('accuracy');
  });
});

describe('decideKeep', () => {
  it('KEEPS a variant that beats its baseline', async () => {
    const baseline = await scoreAccuracy(0.7);
    const better = await scoreAccuracy(0.9, baseline);
    const decision = decideKeep(better, baseline);
    expect(decision.keep).toBe(true);
    expect(decision.delta).toBeCloseTo(0.2);
    expect(decision.regressions).toEqual([]);
  });

  it('REJECTS a variant worse than its baseline (rollback = not kept)', async () => {
    const baseline = await scoreAccuracy(0.9);
    const worse = await scoreAccuracy(0.6, baseline);
    const decision = decideKeep(worse, baseline);
    expect(decision.keep).toBe(false);
    expect(decision.delta).toBeLessThan(0);
    expect(decision.regressions).toContain('accuracy');
  });

  it('REJECTS a variant equal to its baseline (no improvement)', async () => {
    const baseline = await scoreAccuracy(0.8);
    const same = await scoreAccuracy(0.8, baseline);
    expect(decideKeep(same, baseline).keep).toBe(false);
  });

  it('KEEPS a first variant (no baseline) when it produced a real signal', async () => {
    const report = await scoreAccuracy(0.8);
    const decision = decideKeep(report);
    expect(decision.keep).toBe(true);
    expect(decision.reason).toContain('premier variant');
  });

  it('REJECTS a first variant with no signal (score 0)', async () => {
    const zero = await scoreAccuracy(0); // accuracy=0 → score 0
    expect(decideKeep(zero).keep).toBe(false);
  });
});
