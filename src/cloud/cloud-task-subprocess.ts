/**
 * Cloud task process isolation (S7).
 *
 * CloudAgentRunner.executeTask runs a multi-round agent task IN-PROCESS. On a
 * long-running 24/7 daemon that is a real failure mode: a runaway or crashing
 * task can take the daemon down with it. When `CODEBUDDY_CLOUD_SUBPROCESS=true`,
 * the runner instead spawns a child process per task (`buddy cloud-run-task
 * <id>`) that runs the task to completion and writes its status to the shared
 * on-disk task store. A crash in the child cannot kill the parent daemon.
 *
 * No subscription, no remote backend — just a local child process on this machine.
 *
 * @module cloud/cloud-task-subprocess
 */

import { fork as nodeFork, type ChildProcess } from 'child_process';
import path from 'path';

/** Master opt-in for per-task subprocess isolation. */
export const CLOUD_SUBPROCESS_ENV = 'CODEBUDDY_CLOUD_SUBPROCESS';
/** Set in the child so it never re-spawns (runs the task in-process). */
export const CLOUD_SUBPROCESS_CHILD_ENV = 'CODEBUDDY_CLOUD_SUBPROCESS_CHILD';

const TRUTHY = new Set(['1', 'true', 'on', 'yes', 'enabled']);

/**
 * Whether a freshly-submitted cloud task should run in an isolated child. False
 * inside the child (sentinel set) so the child runs the task in-process.
 */
export function shouldIsolateCloudTask(): boolean {
  if (process.env[CLOUD_SUBPROCESS_CHILD_ENV] === '1') return false;
  return TRUTHY.has((process.env[CLOUD_SUBPROCESS_ENV] ?? '').trim().toLowerCase());
}

/** Minimal fork signature so tests can inject a fake spawner. */
export type ForkLike = (
  modulePath: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; stdio: Array<'ignore' | 'inherit' | 'ipc'> },
) => ChildProcess;

export interface CloudTaskSpawnOptions {
  taskId: string;
  tasksDir: string;
  cliEntry?: string;
  fork?: ForkLike;
}

export interface CloudTaskSpawnResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Spawn `buddy cloud-run-task <taskId> --tasks-dir <dir>` as a child process and
 * resolve when it exits. Rejects only if the child fails to spawn. The child
 * writes the task's final status to the shared task store on disk.
 */
export function runCloudTaskSubprocess(options: CloudTaskSpawnOptions): Promise<CloudTaskSpawnResult> {
  const forkFn = options.fork ?? (nodeFork as unknown as ForkLike);
  const cliEntry = options.cliEntry ?? process.argv[1] ?? path.resolve(process.cwd(), 'dist', 'index.js');
  const args = ['cloud-run-task', options.taskId, '--tasks-dir', options.tasksDir];

  return new Promise<CloudTaskSpawnResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = forkFn(cliEntry, args, {
        env: { ...process.env, [CLOUD_SUBPROCESS_CHILD_ENV]: '1' },
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    child.on('error', (err) => reject(err));
    child.on('exit', (code, signal) => resolve({ exitCode: code, signal }));
  });
}
