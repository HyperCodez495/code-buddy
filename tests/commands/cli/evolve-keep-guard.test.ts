/**
 * `evolve keep` merge-target guard — enforces the "never onto main" invariant
 * in CODE. `keep` merges self-evolved code into the CURRENT branch, so it must
 * refuse when that branch is protected (main/master); the maintainer lands via
 * an integration branch + normal PR instead.
 */
import { describe, expect, it } from 'vitest';
import { assertMergeTargetAllowed } from '../../../src/commands/cli/evolve-command.js';

describe('assertMergeTargetAllowed', () => {
  it('refuses main and master (self-evolved code never lands there directly)', () => {
    for (const branch of ['main', 'master', ' main ']) {
      const r = assertMergeTargetAllowed(branch);
      expect(r.ok, branch).toBe(false);
      expect(r.reason).toMatch(/integration branch/);
    }
  });

  it('allows an integration/feature branch', () => {
    for (const branch of ['evolve/keep-v3', 'integration', 'feat/self-improve', 'wip']) {
      expect(assertMergeTargetAllowed(branch).ok, branch).toBe(true);
    }
  });
});
