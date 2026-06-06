import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import {
  CLOUD_SUBPROCESS_CHILD_ENV,
  CLOUD_SUBPROCESS_ENV,
  runCloudTaskSubprocess,
  shouldIsolateCloudTask,
  type ForkLike,
} from '../../src/cloud/cloud-task-subprocess.js';

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [CLOUD_SUBPROCESS_ENV, CLOUD_SUBPROCESS_CHILD_ENV] as const;

describe('cloud task subprocess isolation (S7)', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('gates isolation on the flag and never isolates inside the child', () => {
    expect(shouldIsolateCloudTask()).toBe(false);
    process.env[CLOUD_SUBPROCESS_ENV] = 'true';
    expect(shouldIsolateCloudTask()).toBe(true);
    // Inside the child the sentinel forces in-process execution (no re-spawn).
    process.env[CLOUD_SUBPROCESS_CHILD_ENV] = '1';
    expect(shouldIsolateCloudTask()).toBe(false);
  });

  it('spawns `cloud-run-task` with the child sentinel and resolves on exit', async () => {
    const child = new EventEmitter() as unknown as ChildProcess;
    let captured: { modulePath: string; args: string[]; env: NodeJS.ProcessEnv } | undefined;
    const fakeFork: ForkLike = (modulePath, args, options) => {
      captured = { modulePath, args, env: options.env };
      return child;
    };

    const promise = runCloudTaskSubprocess({
      taskId: 'task-123',
      tasksDir: '/tmp/cloud',
      cliEntry: '/app/dist/index.js',
      fork: fakeFork,
    });
    (child as unknown as EventEmitter).emit('exit', 0, null);
    const result = await promise;

    expect(result).toEqual({ exitCode: 0, signal: null });
    expect(captured?.modulePath).toBe('/app/dist/index.js');
    expect(captured?.args).toEqual(['cloud-run-task', 'task-123', '--tasks-dir', '/tmp/cloud']);
    expect(captured?.env[CLOUD_SUBPROCESS_CHILD_ENV]).toBe('1');
  });

  it('resolves with the non-zero exit code when the child fails', async () => {
    const child = new EventEmitter() as unknown as ChildProcess;
    const fakeFork: ForkLike = () => child;
    const promise = runCloudTaskSubprocess({ taskId: 't', tasksDir: '/tmp', fork: fakeFork });
    (child as unknown as EventEmitter).emit('exit', 1, null);
    expect(await promise).toEqual({ exitCode: 1, signal: null });
  });

  it('rejects when the child fails to spawn', async () => {
    const child = new EventEmitter() as unknown as ChildProcess;
    const fakeFork: ForkLike = () => child;
    const promise = runCloudTaskSubprocess({ taskId: 't', tasksDir: '/tmp', fork: fakeFork });
    (child as unknown as EventEmitter).emit('error', new Error('ENOENT'));
    await expect(promise).rejects.toThrow('ENOENT');
  });
});
