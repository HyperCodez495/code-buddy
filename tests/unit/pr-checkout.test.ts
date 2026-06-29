/**
 * Unit tests for PR handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFileSync = vi.fn();
const mockSpawnSync = vi.fn();

vi.mock('child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { handlePR } from '../../src/commands/handlers/pr-handlers.js';

describe('PR Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  function mockCli(kind: 'gh' | 'glab' | null) {
    mockSpawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args?.[0] === 'gh') return kind === 'gh' ? { status: 0 } : { status: 1 };
      if (args?.[0] === 'glab') return kind === 'glab' ? { status: 0 } : { status: 1 };
      if (args?.includes('--verify') && args.includes('main')) return { status: 0 };
      if (args?.includes('--verify') && args.includes('develop')) return { status: 0 };
      return { status: 1 };
    });
  }

  it('should error when not in a git repo', async () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args.includes('--is-inside-work-tree')) throw new Error('not a git repo');
      return '';
    });

    const result = await handlePR([]);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Not inside a git repository');
  });

  it('should error when on base branch', async () => {
    mockGitRepo('main', true);
    mockCli(null);

    const result = await handlePR([]);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('base branch');
  });

  it('should show CLI install instructions when no CLI is available', async () => {
    mockGitRepo('feature-branch', true);
    mockCli(null);

    const result = await handlePR([]);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Neither');
  });

  it('should create PR with title from args', async () => {
    mockGitRepo('feature-branch', true);
    mockCli('gh');
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args.includes('--is-inside-work-tree')) return 'true';
      if (cmd === 'git' && args.includes('--abbrev-ref')) return 'feature-branch';
      if (cmd === 'git' && args[0] === 'diff') return '';
      if (cmd === 'git' && args[0] === 'log') return '';
      if (cmd === 'gh' && args[0] === 'pr') return 'https://github.com/org/repo/pull/1';
      if (cmd === 'git' && args.includes('--verify') && args.includes('main')) return 'abc123';
      return '';
    });

    const result = await handlePR(['My', 'PR', 'title']);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Pull request created');
  });

  it('should handle --draft flag', async () => {
    mockGitRepo('feature-branch', true);
    mockCli('gh');
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args.includes('--is-inside-work-tree')) return 'true';
      if (cmd === 'git' && args.includes('--abbrev-ref')) return 'feature-branch';
      if (cmd === 'git' && args[0] === 'diff') return '';
      if (cmd === 'git' && args[0] === 'log') return '';
      if (cmd === 'git' && args.includes('--verify') && args.includes('main')) return 'abc123';
      if (cmd === 'gh' && args[0] === 'pr') {
        expect(args).toContain('--draft');
        return 'https://github.com/org/repo/pull/2';
      }
      return '';
    });

    const result = await handlePR(['--draft']);
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('(draft)');
  });
});
