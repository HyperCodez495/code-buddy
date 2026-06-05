import { runScriptCommand } from '../../src/scheduler/script-runner.js';

describe('runScriptCommand', () => {
  it('rejects an executable that is not on the allowlist', async () => {
    await expect(
      runScriptCommand({ executable: 'definitely-not-allowed-binary' }),
    ).rejects.toThrow(/not allowed/);
  });

  it('runs an allowlisted command and captures stdout with exit 0', async () => {
    const result = await runScriptCommand({
      executable: process.execPath, // node — basename is allowlisted
      args: ['-e', 'process.stdout.write("hello cron")'],
    });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain('hello cron');
  });

  it('captures a non-zero exit code without throwing', async () => {
    const result = await runScriptCommand({
      executable: process.execPath,
      args: ['-e', 'process.stderr.write("boom"); process.exit(3)'],
    });
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain('boom');
  });

  it('reports timedOut when the command exceeds the timeout', async () => {
    const result = await runScriptCommand({
      executable: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      timeoutMs: 100,
    });
    expect(result.timedOut).toBe(true);
  });

  it('honours an extra allowed executable via allowedExecutables', async () => {
    // A bogus basename becomes allowed when explicitly listed; spawn will then
    // fail with ENOENT (rejected promise), proving the allowlist gate passed.
    await expect(
      runScriptCommand({
        executable: 'my-custom-runner',
        allowedExecutables: ['my-custom-runner'],
      }),
    ).rejects.toThrow(/ENOENT|spawn/i);
  });
});
