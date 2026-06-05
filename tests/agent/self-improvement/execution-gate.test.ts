import { describe, expect, it } from 'vitest';

import {
  evaluateCheck,
  scoreCorpus,
  validateBehavioralRule,
  summarizeTrajectory,
  verdict,
  type BehavioralCheck,
  type LabeledTrajectory,
  type BehavioralRuleProposal,
} from '../../../src/agent/self-improvement/execution-gate.js';

/** Recorded runs: two compliant (read-only), two that used a mutation tool. */
const CORPUS: LabeledTrajectory[] = [
  { id: 'good-1', shouldPass: true, trajectory: { toolNames: ['view_file', 'search'], text: 'done' } },
  { id: 'good-2', shouldPass: true, trajectory: { toolNames: ['list_directory'], text: 'ok' } },
  { id: 'bad-1', shouldPass: false, trajectory: { toolNames: ['view_file', 'bash'], text: 'ran a command' } },
  { id: 'bad-2', shouldPass: false, trajectory: { toolNames: ['write_file'], text: 'wrote a file' } },
];

function rule(check: BehavioralCheck, statement = 'rule'): BehavioralRuleProposal {
  return { id: `r-${check.kind}-${check.pattern}`, statement, check };
}

describe('execution-grounded gate: deterministic checks', () => {
  it('evaluates checks against recorded tool usage and text', () => {
    const t = { toolNames: ['view_file', 'bash'], text: 'hello world' };
    expect(evaluateCheck({ kind: 'forbid_tool', pattern: 'bash' }, t)).toBe(false); // bash present → forbid fails
    expect(evaluateCheck({ kind: 'require_tool', pattern: 'view_file' }, t)).toBe(true);
    expect(evaluateCheck({ kind: 'require_text', pattern: 'world' }, t)).toBe(true);
    expect(evaluateCheck({ kind: 'forbid_text', pattern: 'secret' }, t)).toBe(true);
  });

  it('scores corpus classification accuracy deterministically', () => {
    const a = scoreCorpus([], CORPUS);
    const b = scoreCorpus([], CORPUS);
    expect(a).toEqual(b);
    // No rules → everything "passes" → only the two should-pass runs are correct.
    expect(a.correct).toBe(2);
    expect(a.accuracy).toBe(0.5);
  });
});

describe('execution-grounded gate: validate behavioral rules', () => {
  it('ACCEPTS a correct rule that reclassifies the bad runs (real correctness, not keywords)', () => {
    const proposal = rule(
      { kind: 'forbid_tool', pattern: 'bash|write_file' },
      'A read-only run must not call bash or write_file.',
    );
    const outcome = validateBehavioralRule(proposal, [], CORPUS);
    expect(outcome.accepted).toBe(true);
    expect(outcome.delta).toBe(2); // both bad runs now correctly fail
    expect(outcome.accuracyAfter).toBe(1);
    expect(outcome.changed.sort()).toEqual(['bad-1', 'bad-2']);
  });

  it('REJECTS an inert rule (changes no recorded behavior) — counterfactual ablation', () => {
    const proposal = rule({ kind: 'forbid_tool', pattern: 'curl' }); // no run uses curl
    const outcome = validateBehavioralRule(proposal, [], CORPUS);
    expect(outcome.accepted).toBe(false);
    expect(outcome.rejectionReason).toBe('inert');
    expect(outcome.changed).toEqual([]);
  });

  it('REJECTS a plausible-but-WRONG rule that misclassifies a good run (the key case)', () => {
    // "Every run must use bash" — sounds like a rule, but it breaks the compliant
    // read-only runs. The retrieval proxy could never catch this; recorded
    // behavior does.
    const proposal = rule({ kind: 'require_tool', pattern: 'bash' }, 'Every run must use bash.');
    const outcome = validateBehavioralRule(proposal, [], CORPUS);
    expect(outcome.accepted).toBe(false);
    expect(outcome.rejectionReason).toBe('regression');
    expect(outcome.regressions).toContain('good-1');
  });

  it('adapts a run-trajectory export into a checkable summary', () => {
    const summary = summarizeTrajectory({
      toolCalls: [{ toolName: 'view_file' }, { toolName: 'bash' }],
      finalAnswer: 'completed the task',
      selectedContext: { profileSignal: 'safe' },
    });
    expect(summary.toolNames).toEqual(['view_file', 'bash']);
    expect(summary.profile).toBe('safe');
    expect(verdict([{ kind: 'forbid_tool', pattern: 'bash' }], summary)).toBe(false);
  });
});
