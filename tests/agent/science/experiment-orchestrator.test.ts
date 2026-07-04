/**
 * AI-Scientist-lite Phase 0 — orchestrator unit tests.
 *
 * Every boundary (idea / novelty / gates / author / execute / analyze / report
 * / review / publish) is an INJECTED fake, so the whole pass runs with ZERO
 * LLM / execution / network. The load-bearing assertions are the two HUMAN
 * GATES failing closed:
 *   - GATE #1 declined ⇒ the experiment is NEVER executed (exec spy not called).
 *   - GATE #2 declined ⇒ NOTHING is published (publish spy not called).
 * Plus: the execution goes through the runner in `envMode:'isolate'` (sandbox),
 * the happy path chains every stage, and the pass never throws.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  runExperiment,
  type ExperimentDeps,
  type GateDecision,
} from '../../../src/agent/science/experiment-orchestrator.js';
import type {
  ExecuteCodeInput,
  ExecuteCodeResult,
  ExecuteCodeRunnerOptions,
} from '../../../src/tools/execute-code-runner.js';

// --------------------------------------------------------------------------
// Fakes
// --------------------------------------------------------------------------

function fakeExecResult(over: Partial<ExecuteCodeResult> = {}): ExecuteCodeResult {
  return {
    kind: 'execute_code_result',
    ok: true,
    runId: 'exec-test',
    language: 'python',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    commandPreview: 'python script.py',
    runDir: '/tmp/run',
    scriptPath: '/tmp/run/script.py',
    stdoutPath: '/tmp/run/stdout.log',
    stderrPath: '/tmp/run/stderr.log',
    resultPath: '/tmp/run/result.json',
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: 'accuracy=0.91\n',
    stderr: '',
    files: ['result.json', 'script.py'],
    ...over,
  };
}

const approve: () => Promise<GateDecision> = async () => ({ approved: true });
const decline: () => Promise<GateDecision> = async () => ({ approved: false, reason: 'not now' });

/** A fully-approving, fully-succeeding deps set with vi spies on every edge. */
function makeDeps(over: Partial<ExperimentDeps> = {}): ExperimentDeps {
  return {
    ideate: vi.fn(async (goal: string) => ({
      hypothesis: `H: ${goal} improves accuracy`,
      rationale: 'A/B on a toy dataset',
      source: 'reasoning' as const,
    })),
    assessNovelty: vi.fn(async () => ({
      noveltyAssessment: 'incremental' as const,
      evidence: ['no exact prior in CKG'],
      summary: 'looks incremental',
    })),
    confirmExperiment: vi.fn(approve),
    authorExperiment: vi.fn(async () => ({ code: 'print("accuracy=0.91")', language: 'python' as const })),
    executeCode: vi.fn(async (_input: ExecuteCodeInput, _options: ExecuteCodeRunnerOptions) =>
      fakeExecResult(),
    ),
    analyze: vi.fn(async () => ({ summary: 'accuracy improved', findings: ['0.91 vs 0.88 baseline'] })),
    report: vi.fn(async () => ({ report: '# Report\n\n## TL;DR\n\nIt improved.', references: [] })),
    review: vi.fn(async () => ({ verdict: 'CONFIRMED' as const, evidence: 'reproduced the number' })),
    confirmPublication: vi.fn(approve),
    publish: vi.fn(async () => undefined),
    ...over,
  };
}

// --------------------------------------------------------------------------
// Happy path
// --------------------------------------------------------------------------

describe('runExperiment — happy path chaining', () => {
  it('chains every stage and publishes when both gates approve', async () => {
    const deps = makeDeps();
    const run = await runExperiment('use focal loss', deps);

    expect(run.status).toBe('published');
    expect(run.published).toBe(true);
    expect(deps.ideate).toHaveBeenCalledOnce();
    expect(deps.assessNovelty).toHaveBeenCalledOnce();
    expect(deps.confirmExperiment).toHaveBeenCalledOnce();
    expect(deps.authorExperiment).toHaveBeenCalledOnce();
    expect(deps.executeCode).toHaveBeenCalledOnce();
    expect(deps.analyze).toHaveBeenCalledOnce();
    expect(deps.report).toHaveBeenCalledOnce();
    expect(deps.review).toHaveBeenCalledOnce();
    expect(deps.confirmPublication).toHaveBeenCalledOnce();
    expect(deps.publish).toHaveBeenCalledOnce();

    // Structured result populated end-to-end.
    expect(run.idea?.hypothesis).toContain('use focal loss');
    expect(run.novelty?.noveltyAssessment).toBe('incremental');
    expect(run.execution?.ok).toBe(true);
    expect(run.analysis?.findings.length).toBeGreaterThan(0);
    expect(run.report?.report).toContain('TL;DR');
    expect(run.review?.verdict).toBe('CONFIRMED');
    expect(run.planGate?.approved).toBe(true);
    expect(run.publishGate?.approved).toBe(true);

    // Ordered stage trace.
    const order = run.stages.map((s) => s.stage);
    expect(order).toEqual([
      'ideate',
      'novelty',
      'plan-gate',
      'author',
      'execute',
      'analyze',
      'report',
      'review',
      'publish-gate',
      'publish',
    ]);
  });
});

// --------------------------------------------------------------------------
// GATE ENFORCEMENT — the most important tests
// --------------------------------------------------------------------------

describe('runExperiment — GATE #1 (fail closed)', () => {
  it('NEVER executes the experiment when the plan gate is declined', async () => {
    const deps = makeDeps({ confirmExperiment: vi.fn(decline) });
    const run = await runExperiment('risky thing', deps);

    expect(run.status).toBe('declined-at-plan-gate');
    // The load-bearing assertion: generated code is never run.
    expect(deps.executeCode).not.toHaveBeenCalled();
    expect(deps.authorExperiment).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
    expect(run.execution).toBeNull();
    expect(run.planGate?.approved).toBe(false);
  });

  it('fails closed when the plan gate THROWS (treated as declined)', async () => {
    const deps = makeDeps({
      confirmExperiment: vi.fn(async () => {
        throw new Error('tty exploded');
      }),
    });
    const run = await runExperiment('risky thing', deps);

    expect(run.status).toBe('declined-at-plan-gate');
    expect(deps.executeCode).not.toHaveBeenCalled();
    expect(run.planGate?.approved).toBe(false);
    expect(run.planGate?.reason).toContain('fail-closed');
  });

  it('fails closed on a non-explicit approval shape', async () => {
    // Returns an object without `approved === true`.
    const deps = makeDeps({
      confirmExperiment: vi.fn(async () => ({ approved: false }) as GateDecision),
    });
    const run = await runExperiment('x', deps);
    expect(run.status).toBe('declined-at-plan-gate');
    expect(deps.executeCode).not.toHaveBeenCalled();
  });
});

describe('runExperiment — GATE #2 (fail closed)', () => {
  it('runs the experiment but NEVER publishes when the publish gate is declined', async () => {
    const deps = makeDeps({ confirmPublication: vi.fn(decline) });
    const run = await runExperiment('safe thing', deps);

    expect(run.status).toBe('declined-at-publish-gate');
    // Execution DID happen (gate #1 approved) …
    expect(deps.executeCode).toHaveBeenCalledOnce();
    // … but NOTHING is ingested into the CKG.
    expect(deps.publish).not.toHaveBeenCalled();
    expect(run.published).toBe(false);
    expect(run.publishGate?.approved).toBe(false);
  });

  it('fails closed when the publish gate THROWS', async () => {
    const deps = makeDeps({
      confirmPublication: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const run = await runExperiment('safe thing', deps);
    expect(run.status).toBe('declined-at-publish-gate');
    expect(deps.publish).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// SANDBOX — execution must go through the runner in isolate mode
// --------------------------------------------------------------------------

describe('runExperiment — sandbox enforcement', () => {
  it('executes generated code with envMode:isolate (non-bypassable)', async () => {
    const execSpy = vi.fn(async (_i: ExecuteCodeInput, _o: ExecuteCodeRunnerOptions) => fakeExecResult());
    const deps = makeDeps({ executeCode: execSpy });
    await runExperiment('measure it', deps, { rootDir: '/work/root', experimentTimeoutMs: 5000 });

    expect(execSpy).toHaveBeenCalledOnce();
    const [input, options] = execSpy.mock.calls[0]!;
    // The security-critical parameter:
    expect(options.envMode).toBe('isolate');
    expect(options.rootDir).toBe('/work/root');
    expect(input.language).toBe('python');
    expect(input.timeoutMs).toBe(5000);
    expect(input.code).toContain('print');
  });

  it('forces isolate even if a caller-shaped option would say otherwise', async () => {
    // The orchestrator builds the options itself; the caller cannot inject inherit.
    const execSpy = vi.fn(async () => fakeExecResult());
    const deps = makeDeps({ executeCode: execSpy });
    await runExperiment('x', deps);
    const options = execSpy.mock.calls[0]![1] as ExecuteCodeRunnerOptions;
    expect(options.envMode).toBe('isolate');
    expect(options.envMode).not.toBe('inherit');
  });
});

// --------------------------------------------------------------------------
// never-throws + graceful degradation
// --------------------------------------------------------------------------

describe('runExperiment — never-throws', () => {
  it('stops cleanly with status=failed when ideation throws (no exception)', async () => {
    const deps = makeDeps({
      ideate: vi.fn(async () => {
        throw new Error('llm down');
      }),
    });
    const run = await runExperiment('anything', deps);
    expect(run.status).toBe('failed');
    expect(run.error).toContain('ideation failed');
    expect(deps.executeCode).not.toHaveBeenCalled();
  });

  it('stops cleanly with status=failed when authoring throws (after gate #1)', async () => {
    const deps = makeDeps({
      authorExperiment: vi.fn(async () => {
        throw new Error('agent crashed');
      }),
    });
    const run = await runExperiment('anything', deps);
    expect(run.status).toBe('failed');
    expect(run.error).toContain('authoring failed');
    expect(deps.executeCode).not.toHaveBeenCalled();
  });

  it('degrades (does NOT crash) when analyze/report/review throw, still publishes', async () => {
    const deps = makeDeps({
      analyze: vi.fn(async () => {
        throw new Error('analysis boom');
      }),
      report: vi.fn(async () => {
        throw new Error('report boom');
      }),
      review: vi.fn(async () => {
        throw new Error('review boom');
      }),
    });
    const run = await runExperiment('resilient', deps);
    // The pass continues past degraded middle stages to the publish gate.
    expect(run.status).toBe('published');
    expect(run.analysis?.summary).toContain('analysis failed');
    expect(run.report?.report).toContain('déterministe');
    expect(run.review?.verdict).toBe('NEEDS REVIEW');
    expect(deps.publish).toHaveBeenCalledOnce();
  });

  it('empty goal → failed without touching any gate or execution', async () => {
    const deps = makeDeps();
    const run = await runExperiment('   ', deps);
    expect(run.status).toBe('failed');
    expect(run.error).toContain('goal is required');
    expect(deps.confirmExperiment).not.toHaveBeenCalled();
    expect(deps.executeCode).not.toHaveBeenCalled();
  });

  it('a non-zero experiment exit is a valid outcome — still reported + publishable', async () => {
    const deps = makeDeps({
      executeCode: vi.fn(async () => fakeExecResult({ ok: false, exitCode: 1, error: 'exited with code 1' })),
    });
    const run = await runExperiment('failing hypothesis', deps);
    expect(run.status).toBe('published');
    expect(run.execution?.ok).toBe(false);
    expect(deps.report).toHaveBeenCalledOnce();
  });

  it('publication failure ⇒ not published, status declined-at-publish-gate with error', async () => {
    const deps = makeDeps({
      publish: vi.fn(async () => {
        throw new Error('ledger locked');
      }),
    });
    const run = await runExperiment('x', deps);
    expect(run.published).toBe(false);
    expect(run.status).toBe('declined-at-publish-gate');
    expect(run.error).toContain('publication failed');
  });
});
