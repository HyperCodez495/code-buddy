/**
 * Worktree scorer (Phase B): materialize a git BRANCH in an isolated worktree, score it with the
 * variant-fitness harness, then tear the worktree down. This is how a candidate variant is
 * evaluated without touching the working tree or `main`.
 *
 * node_modules is symlinked from the base repo (git worktrees don't copy gitignored deps), which is
 * correct as long as the variant didn't change dependencies (the common case; a deps change is a
 * rare edge handled by a real install — flagged, not silently wrong). Disk is preflighted via the
 * disk-guard. The worktree is always cleaned up (finally), the branch is kept as the artifact.
 *
 * @module agent/self-improvement/evolution/worktree-scorer
 */

import { existsSync, symlinkSync } from 'fs';
import { join } from 'path';
import { logger } from '../../../utils/logger.js';
import { WorktreeSessionManager } from '../../../git/worktree-sessions.js';
import { ensureFreeSpace } from '../../../utils/disk-guard.js';
import {
  computeFitness,
  defaultDeterministicComponents,
  type FitnessComponent,
  type FitnessContext,
  type FitnessReport,
} from './variant-fitness.js';

export interface ScoreBranchOptions {
  /** Repo root that owns the worktree. Default: process.cwd(). */
  basePath?: string;
  components?: FitnessComponent[];
  /** Baseline report to flag regressions against. */
  baseline?: FitnessReport;
  timeoutMs?: number;
  /** Env for the fitness subprocesses (pass a scrubbed env for untrusted variants). */
  env?: NodeJS.ProcessEnv;
  /** Symlink node_modules from base into the worktree (default true). */
  linkNodeModules?: boolean;
}

export interface ScoreBranchResult {
  branch: string;
  worktreePath: string;
  report: FitnessReport;
}

/**
 * Score a branch in an isolated worktree. The branch must NOT be the one currently checked out in
 * `basePath` (git refuses to add a worktree for an already-checked-out branch). Never throws on
 * cleanup; throws only if the worktree cannot be created.
 */
export async function scoreBranchInWorktree(branch: string, opts: ScoreBranchOptions = {}): Promise<ScoreBranchResult> {
  const basePath = opts.basePath ?? process.cwd();
  const components = opts.components ?? defaultDeterministicComponents();

  // Preflight disk so a build/test loop can't fill the disk (disk-guard; throws if too low).
  ensureFreeSpace(basePath, undefined, { label: 'evolve worktree' });

  const mgr = WorktreeSessionManager.getInstance();
  const session = mgr.createWorktreeSession(branch, basePath);
  try {
    if (opts.linkNodeModules !== false) {
      linkNodeModules(basePath, session.worktreePath);
    }
    const ctx: FitnessContext = {
      checkoutDir: session.worktreePath,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.env ? { env: opts.env } : {}),
    };
    const report = await computeFitness(ctx, components, opts.baseline);
    return { branch, worktreePath: session.worktreePath, report };
  } finally {
    try {
      mgr.cleanupWorktree(branch);
    } catch (err) {
      logger.warn(`[evolve] worktree cleanup failed for ${branch}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function linkNodeModules(basePath: string, worktreePath: string): void {
  const src = join(basePath, 'node_modules');
  const dest = join(worktreePath, 'node_modules');
  if (!existsSync(src) || existsSync(dest)) return;
  try {
    symlinkSync(src, dest, 'dir');
  } catch (err) {
    logger.warn(`[evolve] node_modules symlink failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
