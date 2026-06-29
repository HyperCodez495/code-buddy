import { execFileSync } from 'child_process';

jest.mock('child_process', () => ({
  execFileSync: jest.fn((command: string, args: string[]) => {
    if (command === 'git' && args[0] === 'rev-parse') {
      throw new Error('fatal: Needed a single revision');
    }
    return Buffer.from('');
  }),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => false),
}));

import { handleWorktree } from '../../src/commands/handlers/worktree-handlers.js';

describe('Worktree shell safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes branch names as arguments instead of shell text', () => {
    const result = handleWorktree(['add', '/tmp/worktree-safe', 'feature; rm -rf /']);

    expect(result.handled).toBe(true);
    expect(execFileSync).toHaveBeenCalledWith(
      'git',
      ['worktree', 'add', '-b', 'feature; rm -rf /', '/tmp/worktree-safe'],
      expect.objectContaining({ stdio: 'pipe' })
    );
  });
});
