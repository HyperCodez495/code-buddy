import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  RuleLearningEngine,
  HeuristicRuleProposer,
} from '../../../src/agent/self-improvement/rule-engine.js';
import { RuleStore, SEED_TRAJECTORY_CORPUS, loadTrajectoryCorpus } from '../../../src/agent/self-improvement/rule-store.js';
import { scoreCorpus } from '../../../src/agent/self-improvement/execution-gate.js';

let dir: string;
let stamp = 0;
const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, stamp++));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-engine-'));
  stamp = 0;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('RuleLearningEngine (execution-grounded loop)', () => {
  it('auto-apply learns correct forbid rules from the corpus until fully classified', () => {
    const ruleStore = new RuleStore({ workDir: dir, now });
    const accepted: string[] = [];
    const engine = new RuleLearningEngine({
      corpus: SEED_TRAJECTORY_CORPUS,
      proposer: new HeuristicRuleProposer(),
      ruleStore,
      autonomy: 'auto-apply',
      onAccept: (p) => accepted.push(p.statement),
      now,
    });

    expect(scoreCorpus([], SEED_TRAJECTORY_CORPUS).accuracy).toBe(0.5);
    const cycles = engine.runLoop();

    const applied = cycles.filter((c) => c.applied);
    expect(applied.length).toBe(2); // forbid bash, forbid write_file
    expect(engine.status().score.accuracy).toBe(1); // corpus fully + correctly classified
    expect(ruleStore.checks()).toHaveLength(2);
    expect(ruleStore.checks().every((c) => c.kind === 'forbid_tool')).toBe(true);
    // The accepted rules are grounded statements about real recorded behavior.
    expect(accepted.some((s) => /must not call bash/.test(s))).toBe(true);
    expect(accepted.some((s) => /must not call write_file/.test(s))).toBe(true);
  });

  it('propose-only validates but persists no rules', () => {
    const ruleStore = new RuleStore({ workDir: dir, now });
    const engine = new RuleLearningEngine({
      corpus: SEED_TRAJECTORY_CORPUS,
      proposer: new HeuristicRuleProposer(),
      ruleStore,
      autonomy: 'propose-only',
      now,
    });
    const result = engine.runCycle();
    expect(result.gate?.accepted).toBe(true); // would correctly reclassify
    expect(result.applied).toBe(false);
    expect(ruleStore.checks()).toHaveLength(0);
  });

  it('reports "nothing to learn" once the corpus is fully classified', () => {
    const ruleStore = new RuleStore({ workDir: dir, now });
    const engine = new RuleLearningEngine({
      corpus: SEED_TRAJECTORY_CORPUS,
      proposer: new HeuristicRuleProposer(),
      ruleStore,
      autonomy: 'auto-apply',
      now,
    });
    engine.runLoop();
    const result = engine.runCycle();
    expect(result.targetId).toBeNull();
    expect(result.notes[0]).toMatch(/nothing to learn/i);
  });

  it('loadTrajectoryCorpus falls back to the seed corpus, and reads corpus.json when present', () => {
    expect(loadTrajectoryCorpus(dir)).toBe(SEED_TRAJECTORY_CORPUS);
    const file = path.join(dir, '.codebuddy', 'self-improvement', 'corpus.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ trajectories: [{ id: 'x', shouldPass: true, trajectory: { toolNames: ['view_file'], text: 'ok' } }] }),
    );
    const loaded = loadTrajectoryCorpus(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe('x');
  });
});
