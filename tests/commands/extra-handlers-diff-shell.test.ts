import { execFileSync } from 'child_process';

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}));

import { handleDiff } from '../../src/commands/handlers/extra-handlers.js';

describe('handleDiff shell safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses structured git argv for diff collection', async () => {
    (execFileSync as unknown as jest.Mock).mockImplementation((command: string, args: string[]) => {
      if (command === 'git' && args[0] === 'rev-parse') return 'true';
      if (command === 'git' && args[0] === 'diff' && args.includes('--cached')) return 'cached diff';
      if (command === 'git' && args[0] === 'diff') return 'unstaged diff';
      return '';
    });

    const result = await handleDiff([]);

    expect(execFileSync).toHaveBeenCalledWith('git', ['rev-parse', '--is-inside-work-tree'], expect.any(Object));
    expect(execFileSync).toHaveBeenCalledWith('git', ['diff'], expect.any(Object));
    expect(execFileSync).toHaveBeenCalledWith('git', ['diff', '--cached'], expect.any(Object));
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('unstaged diff');
  });
});
