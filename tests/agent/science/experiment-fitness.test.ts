/**
 * AI-Scientist-lite Phase 1 — experiment fitness component tests.
 *
 * The load-bearing property is DECOUPLING: the component scores the EXPERIMENT's
 * metric by running its code in the EXPERIMENT FOLDER (ctx.checkoutDir) under
 * envMode:'isolate' — it NEVER runs the repo's tsc/vitest and NEVER receives a
 * repo path. Plus: metric parsing is correct, and a throwing execution floors
 * the score without crashing (never-throws).
 */
import { describe, it, expect, vi } from 'vitest';

import {
  clamp01,
  experimentFitnessComponent,
  stdoutNumberMetric,
  cachedExecutionRunner,
  type ExperimentRunner,
} from '../../../src/agent/science/experiment-fitness.js';
import type {
  ExecuteCodeInput,
  ExecuteCodeResult,
  ExecuteCodeRunnerOptions,
} from '../../../src/tools/execute-code-runner.js';
import type { FitnessContext } from '../../../src/agent/self-improvement/evolution/variant-fitness.js';

function fakeExec(over: Partial<ExecuteCodeResult> = {}): ExecuteCodeResult {
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
    stdout: 'accuracy=0.91\n',
    stderr: '',
    files: ['result.json', 'script.py'],
    ...over,
  };
}

describe('clamp01', () => {
  it('clamps to [0,1] and maps NaN/Infinity to 0', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('stdoutNumberMetric', () => {
  it('parses key=value from stdout as a normalised score', () => {
    const parse = stdoutNumberMetric('accuracy');
    const m = parse(fakeExec({ stdout: 'training...\naccuracy=0.91\n' }));
    expect(m.value).toBeCloseTo(0.91);
    expect(m.score).toBeCloseTo(0.91);
    expect(m.name).toBe('accuracy');
  });

  it('takes the LAST occurrence (the final printed measurement)', () => {
    const parse = stdoutNumberMetric('acc');
    const m = parse(fakeExec({ stdout: 'acc=0.10\nacc: 0.80\n' }));
    expect(m.value).toBeCloseTo(0.8);
  });

  it('returns value=null, score=0 when the metric is absent', () => {
    const parse = stdoutNumberMetric('recall');
    const m = parse(fakeExec({ stdout: 'nothing here' }));
    expect(m.value).toBeNull();
    expect(m.score).toBe(0);
  });

  it('rescales with an explicit range and supports lower-is-better', () => {
    const higher = stdoutNumberMetric('score', { min: 0, max: 200 });
    expect(higher(fakeExec({ stdout: 'score=150' })).score).toBeCloseTo(0.75);
    const lower = stdoutNumberMetric('loss', { higherIsBetter: false, min: 0, max: 10 });
    expect(lower(fakeExec({ stdout: 'loss=2' })).score).toBeCloseTo(0.8);
  });

  // ── F2: a value out of [0,1] with NO range must NOT clamp to a false 1.0 ──────
  it('flags an out-of-[0,1] value (a % like 87.5) with no range instead of clamping to 1.0', () => {
    const parse = stdoutNumberMetric('accuracy'); // no {min,max}
    const m = parse(fakeExec({ stdout: 'accuracy=87.5' }));
    expect(m.value).toBeCloseTo(87.5); // the raw value is preserved for the record
    expect(m.score).toBe(0); // NOT 1.0 — the corruption is refused
    expect(m.outOfRange).toBe(true);
    expect(m.detail).toContain('hors de [0,1]');
    expect(m.detail).toContain('--min/--max');
  });

  it('flags a negative out-of-range value (no range) the same way', () => {
    const parse = stdoutNumberMetric('reward');
    const m = parse(fakeExec({ stdout: 'reward=-5' }));
    expect(m.score).toBe(0);
    expect(m.outOfRange).toBe(true);
  });

  it('a normalised in-[0,1] value with no range is NOT flagged (unchanged behaviour)', () => {
    const parse = stdoutNumberMetric('accuracy');
    const m = parse(fakeExec({ stdout: 'accuracy=0.875' }));
    expect(m.score).toBeCloseTo(0.875);
    expect(m.outOfRange).toBeUndefined();
  });

  it('an explicit range is authoritative: an out-of-[min,max] value still clamps (no flag)', () => {
    const parse = stdoutNumberMetric('score', { min: 0, max: 200 });
    const m = parse(fakeExec({ stdout: 'score=250' })); // > max → user-declared scale
    expect(m.score).toBe(1); // legitimate clamp — the human supplied the range
    expect(m.outOfRange).toBeUndefined();
  });
});

describe('experimentFitnessComponent — DECOUPLING (targets the experiment folder, not the repo)', () => {
  it('runs the experiment code in the experiment folder under envMode:isolate', async () => {
    const runner = vi.fn<ExperimentRunner>(async (_i: ExecuteCodeInput, _o: ExecuteCodeRunnerOptions) =>
      fakeExec({ stdout: 'accuracy=0.88' }),
    );
    const component = experimentFitnessComponent({
      code: 'print("accuracy=0.88")',
      language: 'python',
      executeCode: runner,
      parseMetric: stdoutNumberMetric('accuracy'),
    });
    // The experiment folder — NOT the Code Buddy repo.
    const ctx: FitnessContext = { checkoutDir: '/experiments/exp-42', timeoutMs: 5000 };
    const result = await component.run(ctx);

    expect(runner).toHaveBeenCalledOnce();
    const [input, options] = runner.mock.calls[0]!;
    // Security-critical: sandboxed, and pointed at the EXPERIMENT folder.
    expect(options.envMode).toBe('isolate');
    expect(options.rootDir).toBe('/experiments/exp-42');
    expect(options.rootDir).not.toContain('code-buddy');
    expect(input.code).toContain('accuracy');
    expect(input.language).toBe('python');
    expect(input.timeoutMs).toBe(5000);

    // Scored on the experiment metric.
    expect(result.score).toBeCloseTo(0.88);
    expect(result.passed).toBe(true);
    expect(result.metrics?.value).toBeCloseTo(0.88);
  });

  it('does NOT run the repo test harness — the only executor is the injected runner', async () => {
    // If the component ever shelled out to tsc/vitest it would spawn a process
    // instead of calling our runner. We assert the injected runner is the ONLY
    // path, and it received the experiment folder.
    const seenRootDirs: (string | undefined)[] = [];
    const runner: ExperimentRunner = async (_i, o) => {
      seenRootDirs.push(o.rootDir);
      return fakeExec();
    };
    const component = experimentFitnessComponent({
      code: 'print("accuracy=0.5")',
      language: 'python',
      executeCode: runner,
      parseMetric: stdoutNumberMetric('accuracy'),
    });
    await component.run({ checkoutDir: '/tmp/experiment-run' });
    expect(seenRootDirs).toEqual(['/tmp/experiment-run']);
    // No repo path ever crossed the boundary.
    expect(seenRootDirs.some((d) => d?.includes('/src') || d?.includes('code-buddy'))).toBe(false);
  });
});

describe('experimentFitnessComponent — never-throws', () => {
  it('floors the score (0, not passed) when execution throws', async () => {
    const component = experimentFitnessComponent({
      code: 'boom',
      language: 'python',
      executeCode: async () => {
        throw new Error('sandbox exploded');
      },
      parseMetric: stdoutNumberMetric('accuracy'),
    });
    const result = await component.run({ checkoutDir: '/experiments/x' });
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('floored');
  });

  it('floors the score when the metric parser throws', async () => {
    const component = experimentFitnessComponent({
      code: 'print(1)',
      language: 'python',
      executeCode: async () => fakeExec(),
      parseMetric: () => {
        throw new Error('bad parser');
      },
    });
    const result = await component.run({ checkoutDir: '/experiments/x' });
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('floored');
  });

  it('a non-zero exit / missing metric is not passed but does not crash', async () => {
    const component = experimentFitnessComponent({
      code: 'print("no metric")',
      language: 'python',
      executeCode: async () => fakeExec({ ok: false, exitCode: 1, stdout: 'no metric here' }),
      parseMetric: stdoutNumberMetric('accuracy'),
    });
    const result = await component.run({ checkoutDir: '/experiments/x' });
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
  });

  // ── F2: an out-of-range metric must NOT be a passing "perfect" variant ────────
  it('an out-of-[0,1] metric (a %) scores 0 and is NOT passed (never a false keep)', async () => {
    const component = experimentFitnessComponent({
      code: 'print("accuracy=87.5")',
      language: 'python',
      // ok exec, but the printed value is a percentage with no {min,max} scale.
      executeCode: async () => fakeExec({ ok: true, exitCode: 0, stdout: 'accuracy=87.5' }),
      parseMetric: stdoutNumberMetric('accuracy'),
    });
    const result = await component.run({ checkoutDir: '/experiments/x' });
    expect(result.score).toBe(0); // pre-fix this was a silent 1.0
    expect(result.passed).toBe(false); // ⇒ decideKeep will reject, best() ignores it
    expect(result.detail).toContain('hors de [0,1]');
  });
});

describe('cachedExecutionRunner', () => {
  it('returns the captured result without re-executing', async () => {
    const captured = fakeExec({ stdout: 'accuracy=0.77' });
    const runner = cachedExecutionRunner(captured);
    const out = await runner({ code: 'ignored', language: 'python' }, { envMode: 'isolate', rootDir: '/experiments/x' });
    expect(out).toBe(captured);
  });
});
