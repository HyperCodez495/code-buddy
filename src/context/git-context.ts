/**
 * Git Context Utility
 *
 * Extracted from SmartContextPreloader. Provides lightweight git state
 * queries (branch, recent commits, dirty/staged files) with timeouts
 * and parallel execution. Used by WorkspaceContextBuilder and
 * PromptManager.buildProjectContext().
 *
 * Inspired by Codex CLI's parallel git snapshot with 5s timeout.
 */

import { spawn } from 'child_process';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface GitState {
  /** Current branch name */
  branch: string;
  /** Remote tracking info (e.g. "origin/main") */
  remote: string | null;
  /** Ahead/behind counts vs upstream */
  ahead: number;
  behind: number;
  /** Modified/added/deleted files (staged + unstaged) */
  dirtyFiles: DirtyFile[];
  /** Staged-only files */
  stagedFiles: string[];
  /** Untracked files */
  untrackedFiles: string[];
  /** Recent commits (short hash + message) */
  recentCommits: CommitSummary[];
  /** Whether this is a git repo at all */
  isRepo: boolean;
}

export interface DirtyFile {
  status: string; // M, A, D, R, etc.
  path: string;
}

export interface CommitSummary {
  hash: string;
  message: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_COMMIT_COUNT = 5;

// ============================================================================
// Git Context Functions
// ============================================================================

/**
 * Gather git state in parallel with timeout.
 * Safe to call on non-git directories (returns isRepo: false).
 */
export async function getGitState(
  cwd: string,
  options: { timeoutMs?: number; commitCount?: number } = {}
): Promise<GitState> {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const commitCount = options.commitCount ?? DEFAULT_COMMIT_COUNT;

  const empty: GitState = {
    branch: 'unknown',
    remote: null,
    ahead: 0,
    behind: 0,
    dirtyFiles: [],
    stagedFiles: [],
    untrackedFiles: [],
    recentCommits: [],
    isRepo: false,
  };

  try {
    // Run all git commands in parallel with shared timeout
    const [branch, status, log, upstreamDiff] = await Promise.all([
      execGitTimeout(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, timeout),
      execGitTimeout(['status', '--porcelain'], cwd, timeout),
      execGitTimeout(
        ['log', `--max-count=${commitCount}`, '--pretty=format:%h %s'],
        cwd,
        timeout
      ),
      execGitTimeout(
        ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'],
        cwd,
        timeout
      ).catch(() => null), // no upstream is fine
    ]);

    if (branch === null) {
      return empty; // not a git repo
    }

    const state: GitState = {
      branch: branch.trim(),
      remote: null,
      ahead: 0,
      behind: 0,
      dirtyFiles: [],
      stagedFiles: [],
      untrackedFiles: [],
      recentCommits: [],
      isRepo: true,
    };

    // Parse upstream diff
    if (upstreamDiff) {
      const parts = upstreamDiff.trim().split(/\s+/);
      const [aheadStr, behindStr] = parts;
      if (parts.length === 2 && aheadStr !== undefined && behindStr !== undefined) {
        state.ahead = parseInt(aheadStr, 10) || 0;
        state.behind = parseInt(behindStr, 10) || 0;
      }

      // Get remote name
      const remoteBranch = await execGitTimeout(
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
        cwd,
        timeout
      ).catch(() => null);
      if (remoteBranch) {
        state.remote = remoteBranch.trim();
      }
    }

    // Parse status
    if (status) {
      for (const line of status.split('\n')) {
        if (!line.trim()) continue;
        const xy = line.slice(0, 2);
        const filePath = line.slice(3);

        if (xy === '??') {
          state.untrackedFiles.push(filePath);
        } else {
          const stagedChar = xy[0] ?? ' ';
          const unstagedChar = xy[1] ?? ' ';
          const isStaged = stagedChar !== ' ' && stagedChar !== '?';
          if (isStaged) {
            state.stagedFiles.push(filePath);
          }
          const statusChar = isStaged ? stagedChar : unstagedChar;
          state.dirtyFiles.push({ status: statusChar, path: filePath });
        }
      }
    }

    // Parse log
    if (log) {
      for (const line of log.split('\n')) {
        if (!line.trim()) continue;
        const spaceIdx = line.indexOf(' ');
        if (spaceIdx > 0) {
          state.recentCommits.push({
            hash: line.slice(0, spaceIdx),
            message: line.slice(spaceIdx + 1),
          });
        }
      }
    }

    return state;
  } catch (err) {
    logger.debug('getGitState failed (non-critical)', { err });
    return empty;
  }
}

/**
 * Format GitState into a compact string for prompt injection.
 * Budget: stays under maxChars.
 */
export function formatGitState(state: GitState, maxChars: number = 3000): string {
  if (!state.isRepo) return '';

  const lines: string[] = [];
  lines.push(`Branch: ${state.branch}`);

  if (state.remote) {
    const parts: string[] = [state.remote];
    if (state.ahead > 0 || state.behind > 0) {
      parts.push(`${state.ahead} ahead, ${state.behind} behind`);
    }
    lines.push(`Remote: ${parts.join(' (') + (state.ahead > 0 || state.behind > 0 ? ')' : '')}`);
  }

  // Dirty files
  const dirty = state.dirtyFiles;
  if (dirty.length > 0) {
    const shown = dirty.slice(0, 15);
    const dirtyStr = shown.map(f => `${f.status} ${f.path}`).join(', ');
    const suffix = dirty.length > 15 ? ` (+${dirty.length - 15} more)` : '';
    lines.push(`Dirty files (${dirty.length}): ${dirtyStr}${suffix}`);
  }

  // Untracked
  if (state.untrackedFiles.length > 0) {
    const shown = state.untrackedFiles.slice(0, 10);
    const suffix = state.untrackedFiles.length > 10
      ? ` (+${state.untrackedFiles.length - 10} more)`
      : '';
    lines.push(`Untracked (${state.untrackedFiles.length}): ${shown.join(', ')}${suffix}`);
  }

  // Recent commits
  if (state.recentCommits.length > 0) {
    lines.push('Recent commits:');
    for (const c of state.recentCommits) {
      lines.push(`  ${c.hash} ${c.message}`);
    }
  }

  let result = lines.join('\n');
  if (result.length > maxChars) {
    result = result.slice(0, maxChars - 15) + '\n... (truncated)';
  }
  return result;
}

// ============================================================================
// Internal helpers
// ============================================================================

function execGitTimeout(
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;

    const proc = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGTERM');
        resolve(null);
      }
    }, timeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < 500_000) stdout += chunk.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve(code === 0 ? stdout.trim() : null);
      }
    });

    proc.on('error', () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve(null);
      }
    });
  });
}
