import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

import {
  getRtkRewriteTimeoutMs,
  isRtkRewriteEnabled,
  rewriteCommandWithRtk,
} from '../../src/tools/bash/rtk-rewrite.js';

const ENV_KEYS = [
  'CODEBUDDY_RTK',
  'CODEBUDDY_RTK_REWRITE',
  'CODEBUDDY_RTK_TIMEOUT_MS',
  'GROK_API_KEY',
];

function mockRtkProcess(stdoutText: string, exitCode = 0): void {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.kill = vi.fn();

  spawnMock.mockReturnValue(proc);

  queueMicrotask(() => {
    if (stdoutText) stdout.write(stdoutText);
    stdout.end();
    stderr.end();
    proc.emit('close', exitCode);
  });
}

describe('RTK command rewrite integration', () => {
  const savedEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    spawnMock.mockReset();
    for (const key of ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = savedEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('is opt-in', async () => {
    expect(isRtkRewriteEnabled()).toBe(false);

    const result = await rewriteCommandWithRtk('git status');

    expect(result).toMatchObject({
      command: 'git status',
      rewritten: false,
      reason: 'disabled',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('uses stdout as the rewrite even when rtk exits non-zero', async () => {
    process.env.CODEBUDDY_RTK = '1';
    process.env.GROK_API_KEY = 'xai-secret-should-not-leak';
    mockRtkProcess('rtk git status\n', 3);

    const result = await rewriteCommandWithRtk('git status');

    expect(result).toMatchObject({
      originalCommand: 'git status',
      command: 'rtk git status',
      rewritten: true,
    });
    expect(spawnMock).toHaveBeenCalledWith(
      'rtk',
      ['rewrite', 'git status'],
      expect.objectContaining({
        shell: false,
        env: expect.not.objectContaining({
          GROK_API_KEY: 'xai-secret-should-not-leak',
        }),
      }),
    );
  });

  it('falls back to the original command when rtk proposes nothing', async () => {
    process.env.CODEBUDDY_RTK_REWRITE = 'true';
    mockRtkProcess('', 1);

    const result = await rewriteCommandWithRtk('echo ok');

    expect(result).toMatchObject({
      command: 'echo ok',
      rewritten: false,
      reason: 'no-rewrite',
    });
  });

  it('ignores already-prefixed rtk commands', async () => {
    process.env.CODEBUDDY_RTK = 'auto';

    const result = await rewriteCommandWithRtk('rtk git status');

    expect(result).toMatchObject({
      command: 'rtk git status',
      rewritten: false,
      reason: 'already-rtk',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('bounds rewrite timeout configuration', () => {
    process.env.CODEBUDDY_RTK_TIMEOUT_MS = '25';
    expect(getRtkRewriteTimeoutMs()).toBe(1000);

    process.env.CODEBUDDY_RTK_TIMEOUT_MS = '250';
    expect(getRtkRewriteTimeoutMs()).toBe(250);
  });
});
