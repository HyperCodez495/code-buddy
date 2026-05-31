import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';

import { runHermesRuntimeBackendSmoke } from '../../src/agent/hermes-runtime-backends.js';

function hasRunnableWsl(): boolean {
  if (process.platform !== 'win32') return false;
  const result = spawnSync('wsl', ['--status'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

describe('Hermes runtime backend live smoke runner', () => {
  it('runs the local backend smoke through a real Node subprocess', () => {
    const result = runHermesRuntimeBackendSmoke({
      backendId: 'local',
      env: process.env,
      now: () => new Date('2026-05-31T10:15:00.000Z'),
    });

    expect(result).toMatchObject({
      backendId: 'local',
      command: process.execPath,
      exitCode: 0,
      ok: true,
      status: 'passed',
    });
    expect(result.args).toContain('-e');
    expect(result.stdout).toContain('OK-HERMES-LOCAL');
    expect(result.output).toContain('OK-HERMES-LOCAL');
  });

  it.skipIf(!hasRunnableWsl())('runs the WSL backend smoke through a real WSL shell', () => {
    const result = runHermesRuntimeBackendSmoke({
      backendId: 'wsl',
      env: process.env,
    });

    expect(result).toMatchObject({
      backendId: 'wsl',
      command: 'wsl',
      exitCode: 0,
      ok: true,
      status: 'passed',
    });
    expect(result.args).toEqual(['--exec', 'sh', '-lc', 'echo OK-HERMES-WSL']);
    expect(result.stdout).toContain('OK-HERMES-WSL');
    expect(result.output).toContain('OK-HERMES-WSL');
  });
});
