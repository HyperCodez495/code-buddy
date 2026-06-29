import { spawnSync } from 'child_process';

jest.mock('child_process', () => ({
  spawnSync: jest.fn(),
}));

import { handleTest } from '../../src/commands/handlers/extra-handlers.js';

describe('handleTest shell safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes test arguments without shell interpolation', async () => {
    (spawnSync as unknown as jest.Mock).mockReturnValue({
      stdout: 'ok',
      stderr: '',
      error: undefined,
    });

    const result = await handleTest(['foo; echo pwned']);

    expect(spawnSync).toHaveBeenCalledWith(
      'npm',
      ['test', '--', 'foo; echo pwned'],
      expect.objectContaining({
        cwd: process.cwd(),
        encoding: 'utf-8',
      })
    );
    expect(result.handled).toBe(true);
    expect(result.entry?.content).toContain('Test results for foo; echo pwned');
  });
});
