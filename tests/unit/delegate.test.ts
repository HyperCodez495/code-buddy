/**
 * Tests for Delegate Command
 *
 * Comprehensive tests covering:
 * - Branch name generation
 * - Git repository operations
 * - Pull request creation
 * - Delegate workflow
 * - Error handling
 */

import * as delegate from '../../src/commands/delegate';
import { execFile } from 'child_process';
import crypto from 'crypto';

// Mock child_process
jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

// Mock crypto
jest.mock('crypto', () => {
  const impl = {
  randomBytes: jest.fn().mockReturnValue({
    toString: jest.fn().mockReturnValue('abc123'),
  }),
};
  return { ...impl, default: impl };
});

// const { execFile } = require('child_process'); -- replaced by import
// const crypto = require('crypto'); -- replaced by import

// Helper to create mock exec implementation
function mockExec(responses: Record<string, { stdout?: string; stderr?: string; error?: Error }>) {
  const mock = execFile as unknown as {
    mockImplementation: (implementation: (...args: unknown[]) => void) => void;
  };

  mock.mockImplementation((
    file: unknown,
    args: unknown,
    optionsOrCallback: unknown,
    maybeCallback?: unknown
  ) => {
    const command = [
      String(file),
      ...(Array.isArray(args) ? args.map((arg) => String(arg)) : []),
    ].join(' ');
    const callback =
      typeof maybeCallback === 'function'
        ? maybeCallback
        : typeof optionsOrCallback === 'function'
          ? optionsOrCallback
          : undefined;

    if (!callback) {
      throw new Error('execFile callback missing');
    }

    for (const [pattern, response] of Object.entries(responses)) {
      if (command.includes(pattern)) {
        if (response.error) {
          callback(response.error, { stdout: '', stderr: response.stderr || '' });
        } else {
          callback(null, { stdout: response.stdout || '', stderr: response.stderr || '' });
        }
        return;
      }
    }
    // Default success
    callback(null, { stdout: '', stderr: '' });
  });
}

function execFileCalls(): Array<[string, string[]]> {
  const mock = execFile as unknown as { mock: { calls: unknown[][] } };
  return mock.mock.calls.map((call) => [String(call[0]), Array.isArray(call[1]) ? call[1].map(String) : []]);
}

function expectCommand(file: string, args: string[]): void {
  expect(execFile).toHaveBeenCalledWith(
    file,
    args,
    expect.objectContaining({ windowsHide: true }),
    expect.any(Function)
  );
}

describe('Delegate Command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateBranchName', () => {
    test('should generate branch name from task', () => {
      const branchName = delegate.generateBranchName('Fix all TypeScript errors');

      expect(branchName).toMatch(/^grok\//);
      expect(branchName).toContain('fix-all-typescript-errors');
      expect(branchName).toMatch(/-[a-f0-9]{6}$/);
    });

    test('should lowercase task description', () => {
      const branchName = delegate.generateBranchName('ADD New Feature');

      expect(branchName).toContain('add-new-feature');
      expect(branchName).not.toContain('ADD');
    });

    test('should replace spaces with hyphens', () => {
      const branchName = delegate.generateBranchName('fix bug in parser');

      expect(branchName).toContain('fix-bug-in-parser');
      expect(branchName).not.toContain(' ');
    });

    test('should remove special characters', () => {
      const branchName = delegate.generateBranchName('Fix bug! @#$% in parser');

      expect(branchName).not.toMatch(/[!@#$%]/);
    });

    test('should truncate long task descriptions', () => {
      const longTask = 'This is a very long task description that exceeds forty characters by quite a bit';
      const branchName = delegate.generateBranchName(longTask);

      // Branch name before hash should be at most 40 chars for slug
      const slug = branchName.split('/')[1].split('-').slice(0, -1).join('-');
      expect(slug.length).toBeLessThanOrEqual(40);
    });

    test('should append random hash for uniqueness', () => {
      const branchName = delegate.generateBranchName('Test task');

      expect(branchName).toContain('-abc123');
    });
  });

  describe('isGitRepo', () => {
    test('should return true when in git repo', async () => {
      mockExec({
        'git rev-parse --is-inside-work-tree': { stdout: 'true\n' },
      });

      const result = await delegate.isGitRepo();

      expect(result).toBe(true);
    });

    test('should return false when not in git repo', async () => {
      mockExec({
        'git rev-parse': { error: new Error('Not a git repository') },
      });

      const result = await delegate.isGitRepo();

      expect(result).toBe(false);
    });
  });

  describe('getCurrentBranch', () => {
    test('should return current branch name', async () => {
      mockExec({
        'git branch --show-current': { stdout: 'main\n' },
      });

      const branch = await delegate.getCurrentBranch();

      expect(branch).toBe('main');
    });

    test('should trim whitespace from branch name', async () => {
      mockExec({
        'git branch --show-current': { stdout: '  feature/test  \n' },
      });

      const branch = await delegate.getCurrentBranch();

      expect(branch).toBe('feature/test');
    });
  });

  describe('hasUncommittedChanges', () => {
    test('should return true when there are changes', async () => {
      mockExec({
        'git status --porcelain': { stdout: 'M  src/file.ts\n' },
      });

      const result = await delegate.hasUncommittedChanges();

      expect(result).toBe(true);
    });

    test('should return false when working tree is clean', async () => {
      mockExec({
        'git status --porcelain': { stdout: '' },
      });

      const result = await delegate.hasUncommittedChanges();

      expect(result).toBe(false);
    });

    test('should handle whitespace-only output', async () => {
      mockExec({
        'git status --porcelain': { stdout: '   \n' },
      });

      const result = await delegate.hasUncommittedChanges();

      expect(result).toBe(false);
    });
  });

  describe('createBranch', () => {
    test('should execute git checkout -b command', async () => {
      mockExec({
        'git checkout -b': { stdout: '' },
      });

      await delegate.createBranch('feature/new-branch');

      expectCommand('git', ['checkout', '-b', 'feature/new-branch']);
    });
  });

  describe('commitChanges', () => {
    test('should add all files and commit', async () => {
      mockExec({
        'git add -A': { stdout: '' },
        'git commit': { stdout: '' },
      });

      await delegate.commitChanges('Test commit message');

      expectCommand('git', ['add', '-A']);
      expectCommand('git', ['commit', '-m', 'Test commit message']);
    });

    test('should pass commit message as a single argument', async () => {
      mockExec({
        'git add -A': { stdout: '' },
        'git commit': { stdout: '' },
      });

      const message = 'Fix "bug" in parser $(touch /tmp/pwned)';
      await delegate.commitChanges(message);

      expectCommand('git', ['commit', '-m', message]);
    });
  });

  describe('pushBranch', () => {
    test('should push branch with upstream tracking', async () => {
      mockExec({
        'git push -u origin': { stdout: '' },
      });

      await delegate.pushBranch('feature/test');

      expectCommand('git', ['push', '-u', 'origin', 'feature/test']);
    });
  });

  describe('hasGhCli', () => {
    test('should return true when gh is installed', async () => {
      mockExec({
        'gh --version': { stdout: 'gh version 2.0.0\n' },
      });

      const result = await delegate.hasGhCli();

      expect(result).toBe(true);
    });

    test('should return false when gh is not installed', async () => {
      mockExec({
        'gh --version': { error: new Error('command not found: gh') },
      });

      const result = await delegate.hasGhCli();

      expect(result).toBe(false);
    });
  });

  describe('createPullRequest', () => {
    test('should create PR with all parameters', async () => {
      mockExec({
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/123\n' },
      });

      const result = await delegate.createPullRequest(
        'Test PR',
        'PR body',
        'main',
        true,
        ['bug', 'enhancement'],
        ['reviewer1', 'reviewer2']
      );

      expect(result.url).toBe('https://github.com/owner/repo/pull/123');
      expect(result.number).toBe(123);
    });

    test('should include draft flag when draft is true', async () => {
      mockExec({
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/1\n' },
      });

      await delegate.createPullRequest('Title', 'Body', 'main', true);

      expect(execFileCalls()).toContainEqual([
        'gh',
        ['pr', 'create', '--title', 'Title', '--body', 'Body', '--base', 'main', '--draft'],
      ]);
    });

    test('should not include draft flag when draft is false', async () => {
      mockExec({
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/1\n' },
      });

      await delegate.createPullRequest('Title', 'Body', 'main', false);

      const call = execFileCalls().find(([file, args]) => file === 'gh' && args.join(' ').includes('pr create'));
      expect(call?.[1]).not.toContain('--draft');
    });

    test('should include labels when provided', async () => {
      mockExec({
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/1\n' },
      });

      await delegate.createPullRequest('Title', 'Body', 'main', false, ['bug', 'urgent']);

      expect(execFileCalls()).toContainEqual([
        'gh',
        ['pr', 'create', '--title', 'Title', '--body', 'Body', '--base', 'main', '--label', 'bug,urgent'],
      ]);
    });

    test('should include reviewers when provided', async () => {
      mockExec({
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/1\n' },
      });

      await delegate.createPullRequest('Title', 'Body', 'main', false, [], ['user1']);

      expect(execFileCalls()).toContainEqual([
        'gh',
        ['pr', 'create', '--title', 'Title', '--body', 'Body', '--base', 'main', '--reviewer', 'user1'],
      ]);
    });

    test('should throw error when PR URL cannot be parsed', async () => {
      mockExec({
        'gh pr create': { stdout: 'Some other output\n' },
      });

      await expect(
        delegate.createPullRequest('Title', 'Body', 'main')
      ).rejects.toThrow('Failed to parse PR URL');
    });

    test('should pass title and body as single arguments', async () => {
      mockExec({
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/1\n' },
      });

      const title = 'Fix "bug" $(touch /tmp/pwned)';
      const body = 'Body with "quotes" and `touch /tmp/pwned`';
      await delegate.createPullRequest(title, body, 'main');

      expect(execFileCalls()).toContainEqual([
        'gh',
        ['pr', 'create', '--title', title, '--body', body, '--base', 'main', '--draft'],
      ]);
    });
  });

  describe('addPRComment', () => {
    test('should add comment to PR', async () => {
      mockExec({
        'gh pr comment': { stdout: '' },
      });

      await delegate.addPRComment(123, 'Test comment');

      expectCommand('gh', ['pr', 'comment', '123', '--body', 'Test comment']);
    });

    test('should pass comment as a single argument', async () => {
      mockExec({
        'gh pr comment': { stdout: '' },
      });

      const comment = 'Comment with "quotes" and $(touch /tmp/pwned)';
      await delegate.addPRComment(123, comment);

      expectCommand('gh', ['pr', 'comment', '123', '--body', comment]);
    });
  });

  describe('requestReview', () => {
    test('should request review from multiple reviewers', async () => {
      mockExec({
        'gh pr edit': { stdout: '' },
      });

      await delegate.requestReview(123, ['user1', 'user2']);

      expectCommand('gh', ['pr', 'edit', '123', '--add-reviewer', 'user1,user2']);
    });

    test('should not make request when reviewers list is empty', async () => {
      await delegate.requestReview(123, []);

      expect(execFile).not.toHaveBeenCalled();
    });
  });

  describe('markReady', () => {
    test('should mark PR as ready for review', async () => {
      mockExec({
        'gh pr ready': { stdout: '' },
      });

      await delegate.markReady(123);

      expectCommand('gh', ['pr', 'ready', '123']);
    });
  });

  describe('delegate (main function)', () => {
    test('should fail when not in git repo', async () => {
      mockExec({
        'git rev-parse': { error: new Error('Not a git repo') },
      });

      const result = await delegate.delegate({ task: 'Test task' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Not a git repository');
    });

    test('should fail when gh CLI is not installed', async () => {
      mockExec({
        'git rev-parse': { stdout: 'true' },
        'gh --version': { error: new Error('not found') },
      });

      const result = await delegate.delegate({ task: 'Test task' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('gh CLI not installed');
    });

    test('should complete full workflow successfully', async () => {
      mockExec({
        'git rev-parse': { stdout: 'true' },
        'gh --version': { stdout: 'gh version 2.0.0' },
        'git branch --show-current': { stdout: 'main' },
        'git status --porcelain': { stdout: '' },
        'git checkout -b': { stdout: '' },
        'git push -u origin': { stdout: '' },
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/42\n' },
      });

      const result = await delegate.delegate({ task: 'Fix bug' });

      expect(result.success).toBe(true);
      expect(result.branchName).toMatch(/^grok\/fix-bug-/);
      expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42');
      expect(result.prNumber).toBe(42);
    });

    test('should commit uncommitted changes before creating branch', async () => {
      mockExec({
        'git rev-parse': { stdout: 'true' },
        'gh --version': { stdout: 'gh version 2.0.0' },
        'git branch --show-current': { stdout: 'main' },
        'git status --porcelain': { stdout: 'M  file.ts' },
        'git add -A': { stdout: '' },
        'git commit': { stdout: '' },
        'git checkout -b': { stdout: '' },
        'git push -u origin': { stdout: '' },
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/1\n' },
      });

      const result = await delegate.delegate({ task: 'Test task' });

      expect(result.success).toBe(true);
      expectCommand('git', ['add', '-A']);
    });

    test('should use custom base branch when provided', async () => {
      mockExec({
        'git rev-parse': { stdout: 'true' },
        'gh --version': { stdout: 'gh version 2.0.0' },
        'git branch --show-current': { stdout: 'feature' },
        'git status --porcelain': { stdout: '' },
        'git checkout -b': { stdout: '' },
        'git push -u origin': { stdout: '' },
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/1\n' },
      });

      await delegate.delegate({ task: 'Test', baseBranch: 'develop' });

      expect(execFileCalls().some(([file, args]) => file === 'gh' && args.includes('--base') && args.includes('develop'))).toBe(true);
    });

    test('should pass labels to PR creation', async () => {
      mockExec({
        'git rev-parse': { stdout: 'true' },
        'gh --version': { stdout: 'gh version 2.0.0' },
        'git branch --show-current': { stdout: 'main' },
        'git status --porcelain': { stdout: '' },
        'git checkout -b': { stdout: '' },
        'git push -u origin': { stdout: '' },
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/1\n' },
      });

      await delegate.delegate({
        task: 'Test',
        labels: ['custom-label'],
      });

      expect(execFileCalls().some(([file, args]) => file === 'gh' && args.includes('--label') && args.includes('custom-label'))).toBe(true);
    });

    test('should handle errors gracefully', async () => {
      mockExec({
        'git rev-parse': { stdout: 'true' },
        'gh --version': { stdout: 'gh version 2.0.0' },
        'git branch --show-current': { stdout: 'main' },
        'git status --porcelain': { stdout: '' },
        'git checkout -b': { error: new Error('Branch already exists') },
      });

      const result = await delegate.delegate({ task: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Branch already exists');
    });
  });

  describe('completeDelegate', () => {
    test('should add completion comment and mark ready', async () => {
      mockExec({
        'gh pr comment': { stdout: '' },
        'gh pr ready': { stdout: '' },
      });

      await delegate.completeDelegate(123, 'Task completed successfully');

      expectCommand('gh', ['pr', 'comment', '123', '--body', `## Task Completed

Task completed successfully

---

Ready for review.`]);
      expectCommand('gh', ['pr', 'ready', '123']);
    });

    test('should request review when reviewers provided', async () => {
      mockExec({
        'gh pr comment': { stdout: '' },
        'gh pr ready': { stdout: '' },
        'gh pr edit': { stdout: '' },
      });

      await delegate.completeDelegate(123, 'Done', ['reviewer1']);

      expectCommand('gh', ['pr', 'edit', '123', '--add-reviewer', 'reviewer1']);
    });
  });

  describe('abortDelegate', () => {
    test('should add abort comment and close PR', async () => {
      mockExec({
        'gh pr comment': { stdout: '' },
        'gh pr close': { stdout: '' },
      });

      await delegate.abortDelegate(123, 'Task could not be completed');

      expect(execFileCalls().some(([file, args]) => file === 'gh' && args.some((arg) => arg.includes('Task Aborted')))).toBe(true);
      expectCommand('gh', ['pr', 'close', '123', '--delete-branch']);
    });
  });
});
