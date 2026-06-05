/**
 * No-agent script runner for cron jobs.
 *
 * Hermes Agent's cron supports script-only scheduling — a job that runs a plain
 * command on a schedule without ever invoking the LLM. Code Buddy's `script`
 * task type runs the command directly through this runner.
 *
 * Security follows the deliberate pattern already used by the watchdog and
 * pre-check runners: commands are spawned WITHOUT a shell (`shell: false`),
 * their executable must be on an allowlist (basename match, extendable per
 * job), and they run under a bounded timeout. This avoids the obvious
 * arbitrary-`shell: true` regression while still covering the common case of
 * scheduled maintenance commands (`npm run …`, `git …`, `python …`).
 */

import { spawn } from 'child_process';
import path from 'path';

export interface CronScriptCommand {
  executable: string;
  args?: string[];
  cwd?: string;
  /** Extra allowed executables (basename match), merged with defaults. */
  allowedExecutables?: string[];
  /** Command timeout in ms (default 600000, clamped to [100, 600000]). */
  timeoutMs?: number;
}

export interface CronScriptResult {
  /** Exit code (null when the process was killed by a signal). */
  exitCode: number | null;
  /** Combined stdout + stderr, capped. */
  output: string;
  /** True when the timeout fired and the process was killed. */
  timedOut: boolean;
}

const DEFAULT_SCRIPT_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_BYTES = 1_048_576; // 1 MiB cap on captured output

const DEFAULT_ALLOWED_EXECUTABLES = new Set([
  'bash',
  'cargo',
  'cargo.exe',
  'git',
  'git.exe',
  'go',
  'go.exe',
  'make',
  'node',
  'node.exe',
  'npm',
  'npm.cmd',
  'npx',
  'npx.cmd',
  'pnpm',
  'pnpm.cmd',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
  'python',
  'python.exe',
  'python3',
  'python3.exe',
  'sh',
  'tsc',
  'tsc.cmd',
  'yarn',
  'yarn.cmd',
]);

/**
 * Run a bounded, allowlisted command without a shell. Never instantiates an
 * agent or calls a model provider. Throws synchronously (before spawning) when
 * the executable is not allowlisted; otherwise resolves with the outcome.
 */
export async function runScriptCommand(command: CronScriptCommand): Promise<CronScriptResult> {
  if (!command || typeof command.executable !== 'string' || command.executable.length === 0) {
    throw new Error('script command requires an executable');
  }

  assertExecutableAllowed(command.executable, command.allowedExecutables);

  const timeoutMs = normalizeTimeout(command.timeoutMs);
  return spawnScript(command, timeoutMs);
}

function spawnScript(command: CronScriptCommand, timeoutMs: number): Promise<CronScriptResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args ?? [], {
      cwd: command.cwd,
      shell: false,
      windowsHide: true,
    });

    let output = '';
    let timedOut = false;
    const append = (chunk: string): void => {
      if (output.length < MAX_OUTPUT_BYTES) {
        output += chunk;
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', append);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', append);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, output: output.trimEnd(), timedOut });
    });
  });
}

function assertExecutableAllowed(executable: string, extra: string[] | undefined): void {
  const allowed = new Set([
    ...DEFAULT_ALLOWED_EXECUTABLES,
    ...(extra ?? []).map((value) => value.toLowerCase()),
  ]);
  const name = path.basename(executable).toLowerCase();
  if (!allowed.has(name) && !allowed.has(executable.toLowerCase())) {
    throw new Error(`script executable not allowed: ${executable}`);
  }
}

function normalizeTimeout(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SCRIPT_TIMEOUT_MS;
  }
  return Math.min(600_000, Math.max(100, Math.trunc(value)));
}
