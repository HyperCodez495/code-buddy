/**
 * /delegate Command - Automated PR Creation (GitHub Copilot CLI inspired)
 *
 * Delegates a task to run in the background:
 * 1. Creates a new branch from current HEAD
 * 2. Commits any unstaged changes
 * 3. Creates a draft PR
 * 4. Agent works on the task
 * 5. Requests review when done
 *
 * Usage: /delegate Fix all TypeScript errors
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);

interface CommandResult {
  stdout: string;
  stderr: string;
}

function normalizeCommandResult(result: unknown): CommandResult {
  if (typeof result === 'object' && result !== null && 'stdout' in result) {
    const value = result as { stdout?: unknown; stderr?: unknown };
    return {
      stdout: typeof value.stdout === 'string' ? value.stdout : String(value.stdout ?? ''),
      stderr: typeof value.stderr === 'string' ? value.stderr : String(value.stderr ?? ''),
    };
  }

  return {
    stdout: typeof result === 'string' ? result : String(result ?? ''),
    stderr: '',
  };
}

async function runCommand(file: string, args: string[]): Promise<CommandResult> {
  const result = await execFileAsync(file, args, { windowsHide: true });
  return normalizeCommandResult(result);
}

function assertPositivePrNumber(prNumber: number): void {
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`Invalid pull request number: ${prNumber}`);
  }
}

function assertSafeBranchName(branchName: string): void {
  const isSafe =
    branchName.length > 0 &&
    branchName.length <= 255 &&
    !branchName.startsWith('-') &&
    !branchName.endsWith('/') &&
    !branchName.includes('..') &&
    !branchName.includes('//') &&
    // eslint-disable-next-line no-control-regex
    !/[~^:?*[\]\\\s\x00-\x1f\x7f]/.test(branchName) &&
    /^[A-Za-z0-9._/-]+$/.test(branchName);

  if (!isSafe) {
    throw new Error(`Invalid git branch name: ${branchName}`);
  }
}

function assertSafeLabel(label: string): void {
  const isSafe =
    label.length > 0 &&
    label.length <= 100 &&
    !label.includes(',') &&
    // eslint-disable-next-line no-control-regex
    !/[\x00-\x1f\x7f]/.test(label);

  if (!isSafe) {
    throw new Error(`Invalid GitHub label: ${label}`);
  }
}

function assertSafeReviewer(reviewer: string): void {
  const login = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?';
  const reviewerPattern = new RegExp(`^(?:${login}/)?${login}$`);

  if (!reviewerPattern.test(reviewer)) {
    throw new Error(`Invalid GitHub reviewer: ${reviewer}`);
  }
}

/**
 * Configuration for a delegation task.
 */
export interface DelegateConfig {
  /** Description of the task to perform. */
  task: string;
  /** Base branch to target (defaults to current branch). */
  baseBranch?: string;
  /** Whether to create a draft PR (default: true). */
  draft?: boolean;
  /** List of GitHub usernames to request review from. */
  reviewers?: string[];
  /** Labels to apply to the PR. */
  labels?: string[];
  /** Whether to enable auto-merge (if supported). */
  autoMerge?: boolean;
}

/**
 * Result of a delegation operation.
 */
export interface DelegateResult {
  /** Whether the delegation started successfully. */
  success: boolean;
  /** The name of the created branch. */
  branchName?: string;
  /** The URL of the created Pull Request. */
  prUrl?: string;
  /** The number of the created Pull Request. */
  prNumber?: number;
  /** Error message if failed. */
  error?: string;
}

/**
 * Generates a unique branch name based on the task description.
 * Format: grok/<slugged-task>-<random-hash>
 *
 * @param task - The task description.
 * @returns The generated branch name.
 */
export function generateBranchName(task: string): string {
  const slug = task
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40);

  const hash = crypto.randomBytes(3).toString('hex');
  return `grok/${slug}-${hash}`;
}

/**
 * Checks if the current directory is inside a git repository.
 *
 * @returns True if in a git repo.
 */
export async function isGitRepo(): Promise<boolean> {
  try {
    await runCommand('git', ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets the name of the current git branch.
 *
 * @returns The current branch name.
 */
export async function getCurrentBranch(): Promise<string> {
  const { stdout } = await runCommand('git', ['branch', '--show-current']);
  return stdout.trim();
}

/**
 * Checks if there are any uncommitted changes (staged or unstaged).
 *
 * @returns True if changes exist.
 */
export async function hasUncommittedChanges(): Promise<boolean> {
  const { stdout } = await runCommand('git', ['status', '--porcelain']);
  return stdout.trim().length > 0;
}

/**
 * Creates a new git branch.
 *
 * @param branchName - Name of the new branch.
 */
export async function createBranch(branchName: string): Promise<void> {
  assertSafeBranchName(branchName);
  await runCommand('git', ['checkout', '-b', branchName]);
}

/**
 * Commits all changes (staged and unstaged) with a message.
 *
 * @param message - The commit message.
 */
export async function commitChanges(message: string): Promise<void> {
  await runCommand('git', ['add', '-A']);
  await runCommand('git', ['commit', '-m', message]);
}

/**
 * Pushes the specified branch to the remote origin.
 *
 * @param branchName - The branch to push.
 */
export async function pushBranch(branchName: string): Promise<void> {
  assertSafeBranchName(branchName);
  await runCommand('git', ['push', '-u', 'origin', branchName]);
}

/**
 * Checks if the GitHub CLI (gh) is installed and available.
 *
 * @returns True if gh is available.
 */
export async function hasGhCli(): Promise<boolean> {
  try {
    await runCommand('gh', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a Pull Request using the GitHub CLI.
 *
 * @param title - PR title.
 * @param body - PR description.
 * @param baseBranch - Base branch to merge into.
 * @param draft - Whether to create as draft.
 * @param labels - Labels to apply.
 * @param reviewers - Reviewers to request.
 * @returns Object containing PR URL and number.
 */
export async function createPullRequest(
  title: string,
  body: string,
  baseBranch: string,
  draft: boolean = true,
  labels: string[] = [],
  reviewers: string[] = []
): Promise<{ url: string; number: number }> {
  assertSafeBranchName(baseBranch);
  labels.forEach(assertSafeLabel);
  reviewers.forEach(assertSafeReviewer);

  const args = ['pr', 'create', '--title', title, '--body', body, '--base', baseBranch];
  if (draft) {
    args.push('--draft');
  }

  if (labels.length > 0) {
    args.push('--label', labels.join(','));
  }

  if (reviewers.length > 0) {
    args.push('--reviewer', reviewers.join(','));
  }

  const { stdout } = await runCommand('gh', args);

  // Parse PR URL and number from output
  const urlMatch = stdout.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/);
  if (urlMatch && urlMatch[1] !== undefined) {
    return {
      url: urlMatch[0],
      number: parseInt(urlMatch[1], 10),
    };
  }

  throw new Error('Failed to parse PR URL from gh output');
}

/**
 * Adds a comment to an existing Pull Request.
 *
 * @param prNumber - The PR number.
 * @param comment - The comment text.
 */
export async function addPRComment(prNumber: number, comment: string): Promise<void> {
  assertPositivePrNumber(prNumber);
  await runCommand('gh', ['pr', 'comment', String(prNumber), '--body', comment]);
}

/**
 * Requests review from specified users on a Pull Request.
 *
 * @param prNumber - The PR number.
 * @param reviewers - Array of GitHub usernames.
 */
export async function requestReview(prNumber: number, reviewers: string[]): Promise<void> {
  assertPositivePrNumber(prNumber);
  reviewers.forEach(assertSafeReviewer);

  if (reviewers.length > 0) {
    await runCommand('gh', ['pr', 'edit', String(prNumber), '--add-reviewer', reviewers.join(',')]);
  }
}

/**
 * Marks a Pull Request as ready for review (removes draft status).
 *
 * @param prNumber - The PR number.
 */
export async function markReady(prNumber: number): Promise<void> {
  assertPositivePrNumber(prNumber);
  await runCommand('gh', ['pr', 'ready', String(prNumber)]);
}

/**
 * Main entry point for delegating a task.
 * Orchestrates branch creation, committing, pushing, and PR creation.
 *
 * @param config - Delegation configuration.
 * @returns Result of the delegation process.
 */
export async function delegate(config: DelegateConfig): Promise<DelegateResult> {
  try {
    // Validate environment
    if (!(await isGitRepo())) {
      return { success: false, error: 'Not a git repository' };
    }

    if (!(await hasGhCli())) {
      return { success: false, error: 'gh CLI not installed. Install from https://cli.github.com' };
    }

    const currentBranch = await getCurrentBranch();
    const baseBranch = config.baseBranch || currentBranch;
    const branchName = generateBranchName(config.task);

    console.log(`Creating branch: ${branchName}`);

    // Commit any unstaged changes first
    if (await hasUncommittedChanges()) {
      console.log('Committing unstaged changes...');
      await commitChanges(`WIP: Starting task - ${config.task}`);
    }

    // Create new branch
    await createBranch(branchName);

    // Push branch
    console.log('Pushing branch to remote...');
    await pushBranch(branchName);

    // Create PR body
    const prBody = `## Task

${config.task}

## Status

This PR was created by Code Buddy using \`/delegate\`.

The agent is working on this task in the background.

---

Generated with [Code Buddy](https://github.com/phuetz/code-buddy)`;

    // Create PR
    console.log('Creating pull request...');
    const pr = await createPullRequest(
      `[Grok] ${config.task.slice(0, 60)}${config.task.length > 60 ? '...' : ''}`,
      prBody,
      baseBranch,
      config.draft !== false,
      config.labels || ['code-buddy', 'automated'],
      config.reviewers || []
    );

    console.log(`Pull request created: ${pr.url}`);

    return {
      success: true,
      branchName,
      prUrl: pr.url,
      prNumber: pr.number,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Completes a delegation task.
 * Marks the PR as ready and requests review.
 *
 * @param prNumber - The PR number.
 * @param summary - Summary of work completed.
 * @param reviewers - Optional list of reviewers to request.
 */
export async function completeDelegate(
  prNumber: number,
  summary: string,
  reviewers: string[] = []
): Promise<void> {
  // Add completion comment
  await addPRComment(prNumber, `## Task Completed

${summary}

---

Ready for review.`);

  // Mark as ready
  await markReady(prNumber);

  // Request review
  if (reviewers.length > 0) {
    await requestReview(prNumber, reviewers);
  }
}

/**
 * Aborts a delegation task.
 * Adds a comment explaining why, closes the PR, and deletes the branch.
 *
 * @param prNumber - The PR number.
 * @param reason - Reason for abortion.
 */
export async function abortDelegate(
  prNumber: number,
  reason: string
): Promise<void> {
  await addPRComment(prNumber, `## Task Aborted

${reason}`);

  assertPositivePrNumber(prNumber);
  await runCommand('gh', ['pr', 'close', String(prNumber), '--delete-branch']);
}
