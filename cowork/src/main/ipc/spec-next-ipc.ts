/**
 * `spec.next` IPC — run the autonomous coding runner for an approved story by
 * shelling out to the core CLI (`buddy spec next`) as a child process.
 *
 * Why a child process (not an in-process `runAgenticCodingCell`): the runner is
 * long-running and spawns shell verification; running it inside Electron's main
 * process would risk blocking the loop. Instead we `spawn` the built core CLI with
 * `ELECTRON_RUN_AS_NODE=1` (so the Electron binary behaves as plain node), buffer
 * its output, and resolve when it exits. The CLI is the source of truth — it owns
 * the story → run → outcome lineage; Cowork just launches and observes.
 *
 * MVP: buffered request/response (no live streaming) with a hard timeout. The
 * default Cowork action is `--dry-run` (instant, side-effect-free: shows the
 * contract that would run). Live streaming + cancellation are a follow-up.
 *
 * @module main/ipc/spec-next-ipc
 */

import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { logError } from '../utils/logger';
import { resolveCoreEntry } from '../utils/core-loader';
import { resolveWorkDir, errorMessage, type ProjectManagerSource } from './ipc-workdir';

export interface SpecNextInput {
  storyId?: string;
  dryRun?: boolean;
  fleet?: 'none' | 'read-only-help' | 'delegated-slices';
  allowedPaths?: string[];
  verify?: string[];
  runVerification?: boolean;
}

export interface SpecNextResult {
  ok: boolean;
  error?: string;
  code?: number;
  stdout?: string;
  stderr?: string;
}

/** Build the `spec next` CLI args. Pure — unit-tested. */
export function buildSpecNextArgs(input: SpecNextInput): string[] {
  const args = ['spec', 'next'];
  if (input.storyId) args.push('--story', input.storyId);
  if (input.dryRun) args.push('--dry-run');
  if (input.fleet && input.fleet !== 'none') args.push('--fleet', input.fleet);
  for (const p of input.allowedPaths ?? []) if (p.trim()) args.push('--allowed-path', p.trim());
  for (const v of input.verify ?? []) if (v.trim()) args.push('--verify', v.trim());
  if (input.runVerification) args.push('--run-verification');
  return args;
}

/** Hard cap so a stuck/runaway run can never hang the handle forever. */
const MAX_RUN_MS = 10 * 60 * 1000;

export function registerSpecNextIpcHandlers(projectManagerSource: ProjectManagerSource): void {
  ipcMain.handle('spec.next', async (_e, input: SpecNextInput = {}, coworkProjectId?: string): Promise<SpecNextResult> => {
    const workDir = resolveWorkDir(projectManagerSource, coworkProjectId);
    if (!workDir) return { ok: false, error: 'NO_ACTIVE_PROJECT' };
    const entry = resolveCoreEntry();
    if (!entry) {
      return { ok: false, error: 'Code Buddy core CLI is not built (no dist/index.js). Build the core, then retry.' };
    }

    const args = [entry, ...buildSpecNextArgs(input)];
    return await new Promise<SpecNextResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (r: SpecNextResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };

      const child = spawn(process.execPath, args, {
        cwd: workDir,
        // Make the Electron binary run as plain node for the core CLI.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        finish({ ok: false, error: `spec next exceeded ${MAX_RUN_MS / 1000}s and was stopped`, stdout, stderr });
      }, MAX_RUN_MS);

      child.stdout?.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      child.on('error', (err) => {
        logError('[spec.next] spawn failed:', err);
        finish({ ok: false, error: errorMessage(err), stdout, stderr });
      });
      child.on('close', (code) => {
        finish({ ok: code === 0, code: code ?? -1, stdout, stderr });
      });
    });
  });
}
