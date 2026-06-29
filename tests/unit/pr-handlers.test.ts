/**
 * Unit Tests for PR Handlers
 */

import { handlePR } from '../../src/commands/handlers/pr-handlers';
import { execFileSync, spawnSync } from 'child_process';

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
  spawnSync: jest.fn(),
}));

const mockExecFileSync = execFileSync as jest.Mock;
const mockSpawnSync = spawnSync as jest.Mock;

describe('PR Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockGitRepo(branch = 'feature-branch', baseExists = true) {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args.includes('--is-inside-work-tree')) return 'true';
      if (cmd === 'git' && args.includes('--abbrev-ref')) return branch;
      if (cmd === 'git' && args[0] === 'diff') return '';
      if (cmd === 'git' && args[0] === 'log') return '';
      if (cmd === 'git' && args.includes('--verify') && args.includes('main')) {
        return baseExists ? 'abc123' : '';
      }
      return '';
    });
  }

  function mockCli(kind: 'gh' | 'glab' | null, developExists = false) {
    mockSpawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args?.[0] === 'gh') return kind === 'gh' ? { status: 0, stdout: '/usr/bin/gh\n', stderr: '' } : { status: 1, stdout: '', stderr: '' };
      if (args?.[0] === 'glab') return kind === 'glab' ? { status: 0, stdout: '/usr/bin/glab\n', stderr: '' } : { status: 1, stdout: '', stderr: '' };
      if (args?.includes('--verify') && args.includes('develop')) {
        return developExists ? { status: 0, stdout: 'abc123\n', stderr: '' } : { status: 1, stdout: '', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: '' };
    });
  }

  it('should return error when not in a git repo', async () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args.includes('--is-inside-work-tree')) throw new Error('not a git repo');
      return '';
    });

    const result = await handlePR([]);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Not inside a git repository');
  });

  it('should return error when on base branch', async () => {
    mockGitRepo('main', true);
    mockCli(null);

    const result = await handlePR([]);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Cannot create PR');
    expect(result.entry?.content).toContain('base branch');
  });

  it('should show manual instructions when no CLI is available', async () => {
    mockGitRepo('feature/my-feature', true);
    mockCli(null);

    const result = await handlePR([]);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Neither `gh`');
    expect(result.entry?.content).toContain('gh pr create');
    expect(result.entry?.content).toContain('glab mr create');
  });

  it('should create PR with gh when available', async () => {
    mockGitRepo('feature/add-login', true);
    mockCli('gh');
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args.includes('--is-inside-work-tree')) return 'true';
      if (cmd === 'git' && args.includes('--abbrev-ref')) return 'feature/add-login';
      if (cmd === 'git' && args[0] === 'diff') return '3 files changed\n';
      if (cmd === 'git' && args[0] === 'log') return 'abc1234 feat: add login page\n';
      if (cmd === 'gh' && args[0] === 'pr') return 'https://github.com/owner/repo/pull/42\n';
      if (cmd === 'git' && args.includes('--verify') && args.includes('main')) return 'abc123';
      return '';
    });

    const result = await handlePR([]);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Pull request created');
    expect(result.entry?.content).toContain('https://github.com/owner/repo/pull/42');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'gh',
      ['pr', 'create', '--base', 'main', '--title', 'feat: add login page', '--body', expect.any(String)],
      expect.objectContaining({ cwd: process.cwd() }),
    );
  });

  it('should support --draft flag', async () => {
    mockGitRepo('fix/bug-123', true);
    mockCli('gh');
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args.includes('--is-inside-work-tree')) return 'true';
      if (cmd === 'git' && args.includes('--abbrev-ref')) return 'fix/bug-123';
      if (cmd === 'git' && args[0] === 'diff') return '1 file changed\n';
      if (cmd === 'git' && args[0] === 'log') return 'def5678 fix: resolve null pointer\n';
      if (cmd === 'gh' && args[0] === 'pr') {
        expect(args).toContain('--draft');
        return 'https://github.com/owner/repo/pull/43\n';
      }
      if (cmd === 'git' && args.includes('--verify') && args.includes('main')) return 'abc123';
      return '';
    });

    const result = await handlePR(['--draft']);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('(draft)');
  });

  it('should use custom title when provided', async () => {
    let capturedArgs: string[] = [];
    mockGitRepo('feature/stuff', true);
    mockCli('gh');
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args.includes('--is-inside-work-tree')) return 'true';
      if (cmd === 'git' && args.includes('--abbrev-ref')) return 'feature/stuff';
      if (cmd === 'git' && args[0] === 'diff') return '1 file changed\n';
      if (cmd === 'git' && args[0] === 'log') return '';
      if (cmd === 'gh' && args[0] === 'pr') {
        capturedArgs = args;
        return 'https://github.com/owner/repo/pull/44\n';
      }
      if (cmd === 'git' && args.includes('--verify') && args.includes('main')) return 'abc123';
      return '';
    });

    const result = await handlePR(['My', 'Custom', 'Title']);
    expect(result.handled).toBe(true);
    expect(capturedArgs).toContain('My Custom Title');
  });

  it('should handle PR creation failure gracefully', async () => {
    mockGitRepo('feature/x', true);
    mockCli('gh');
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args.includes('--is-inside-work-tree')) return 'true';
      if (cmd === 'git' && args.includes('--abbrev-ref')) return 'feature/x';
      if (cmd === 'git' && args[0] === 'diff') return '';
      if (cmd === 'git' && args[0] === 'log') return '';
      if (cmd === 'gh' && args[0] === 'pr') {
        const err = new Error('Not authenticated') as Error & { stdout: string; stderr: string };
        err.stdout = '';
        err.stderr = 'gh: Not logged in';
        throw err;
      }
      if (cmd === 'git' && args.includes('--verify') && args.includes('main')) return 'abc123';
      return '';
    });

    const result = await handlePR([]);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('PR creation failed');
    expect(result.entry?.content).toContain('gh auth login');
  });

  it('should detect develop as base branch when main/master missing', async () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args.includes('--is-inside-work-tree')) return 'true';
      if (cmd === 'git' && args.includes('--abbrev-ref')) return 'feature/y';
      if (cmd === 'git' && args[0] === 'diff') return '';
      if (cmd === 'git' && args[0] === 'log') return '';
      return '';
    });

    mockSpawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args?.[0] === 'gh') return { status: 0, stdout: '/usr/bin/gh\n', stderr: '' };
      if (args?.includes('--verify') && args.includes('main')) return { status: 1, stdout: '', stderr: '' };
      if (args?.includes('--verify') && args.includes('master')) return { status: 1, stdout: '', stderr: '' };
      if (args?.includes('--verify') && args.includes('develop')) return { status: 0, stdout: 'abc123\n', stderr: '' };
      return { status: 1, stdout: '', stderr: '' };
    });

    const result = await handlePR([]);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Pull request created');
  });
});
