/**
 * No-agent watchdog handlers.
 *
 * Hermes Agent's cron can run lightweight monitors that never invoke the LLM:
 * disk checks, server pings, repo status, build status. Code Buddy's scheduler
 * previously only had `message`/`tool`/`agent` task types, each of which spins
 * up a `CodeBuddyAgent` and burns tokens. A watchdog job runs these checks
 * directly — no agent, no provider call — so simple monitoring stays cheap.
 *
 * Each check returns one of:
 *   - `ok`    — the monitored condition is healthy.
 *   - `alert` — the check ran but the condition is breached (disk low, server
 *               down, repo dirty, build failed).
 *   - `error` — the check itself could not run (missing binary, bad path).
 *
 * The aggregate `ok` is true only when there are no alerts and no errors.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

export type CronWatchdogCheckType = 'disk' | 'http' | 'repo' | 'build';

export interface CronWatchdogCheck {
  type: CronWatchdogCheckType;
  /** Optional human label for output. */
  name?: string;

  // disk
  /** Path whose filesystem free space is checked (default: cwd). */
  path?: string;
  /** Alert when free bytes fall below this. */
  minFreeBytes?: number;
  /** Alert when free space percentage falls below this (0–100). */
  minFreePercent?: number;

  // http
  /** URL to probe with a GET request. */
  url?: string;
  /** Alert when the status code is >= this (default 400). */
  expectStatusBelow?: number;
  /** Probe timeout in ms (default 10000). */
  timeoutMs?: number;

  // repo
  /** Git repository directory (default: cwd). */
  repoDir?: string;
  /** When true (default), a dirty working tree is an alert. */
  expectClean?: boolean;

  // build
  /** Build command, spawned without a shell. Exit 0 = ok, else alert. */
  command?: { executable: string; args?: string[]; cwd?: string };
}

export interface CronWatchdog {
  checks: CronWatchdogCheck[];
  /** Extra allowed build executables (basename match), merged with defaults. */
  allowedExecutables?: string[];
}

export interface WatchdogCheckResult {
  type: CronWatchdogCheckType;
  name: string;
  status: 'ok' | 'alert' | 'error';
  summary: string;
  details: Record<string, unknown>;
}

export interface WatchdogRunResult {
  /** True when no check produced an alert or error. */
  ok: boolean;
  alerts: number;
  errors: number;
  checks: WatchdogCheckResult[];
  summary: string;
}

const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
const DEFAULT_BUILD_ALLOWED_EXECUTABLES = new Set([
  'bash',
  'cargo',
  'cargo.exe',
  'go',
  'go.exe',
  'make',
  'node',
  'node.exe',
  'npm',
  'npm.cmd',
  'pnpm',
  'pnpm.cmd',
  'pwsh',
  'pwsh.exe',
  'python',
  'python.exe',
  'python3',
  'sh',
  'tsc',
  'tsc.cmd',
  'yarn',
  'yarn.cmd',
]);

/**
 * Run every configured watchdog check. Never instantiates an agent or calls a
 * model provider.
 */
export async function runWatchdog(watchdog: CronWatchdog): Promise<WatchdogRunResult> {
  const checks = Array.isArray(watchdog?.checks) ? watchdog.checks : [];
  if (checks.length === 0) {
    return {
      ok: false,
      alerts: 0,
      errors: 1,
      checks: [
        {
          type: 'disk',
          name: 'watchdog',
          status: 'error',
          summary: 'watchdog has no checks configured',
          details: {},
        },
      ],
      summary: 'watchdog misconfigured: no checks',
    };
  }

  const results: WatchdogCheckResult[] = [];
  for (const check of checks) {
    results.push(await runSingleCheck(check, watchdog.allowedExecutables));
  }

  const alerts = results.filter((r) => r.status === 'alert').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const ok = alerts === 0 && errors === 0;
  return {
    ok,
    alerts,
    errors,
    checks: results,
    summary: buildSummary(ok, alerts, errors, results),
  };
}

async function runSingleCheck(
  check: CronWatchdogCheck,
  allowedExecutables: string[] | undefined,
): Promise<WatchdogCheckResult> {
  const name = check.name ?? check.type;
  try {
    switch (check.type) {
      case 'disk':
        return checkDisk(check, name);
      case 'http':
        return await checkHttp(check, name);
      case 'repo':
        return await checkRepo(check, name);
      case 'build':
        return await checkBuild(check, name, allowedExecutables);
      default:
        return {
          type: check.type,
          name,
          status: 'error',
          summary: `unknown watchdog check type: ${String((check as { type?: unknown }).type)}`,
          details: {},
        };
    }
  } catch (err) {
    return {
      type: check.type,
      name,
      status: 'error',
      summary: `check threw: ${errMsg(err)}`,
      details: {},
    };
  }
}

function checkDisk(check: CronWatchdogCheck, name: string): WatchdogCheckResult {
  const target = check.path || process.cwd();
  const statfs = (fs as unknown as { statfsSync?: (p: string) => { bsize: number; blocks: number; bavail: number } }).statfsSync;
  if (typeof statfs !== 'function') {
    return {
      type: 'disk',
      name,
      status: 'error',
      summary: 'fs.statfsSync is not available in this Node runtime',
      details: { path: target },
    };
  }

  let stats: { bsize: number; blocks: number; bavail: number };
  try {
    stats = statfs(target);
  } catch (err) {
    return {
      type: 'disk',
      name,
      status: 'error',
      summary: `cannot stat filesystem at ${target}: ${errMsg(err)}`,
      details: { path: target },
    };
  }

  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bavail * stats.bsize;
  const freePercent = totalBytes > 0 ? (freeBytes / totalBytes) * 100 : 0;

  const breaches: string[] = [];
  if (typeof check.minFreeBytes === 'number' && freeBytes < check.minFreeBytes) {
    breaches.push(`free ${formatBytes(freeBytes)} < min ${formatBytes(check.minFreeBytes)}`);
  }
  if (typeof check.minFreePercent === 'number' && freePercent < check.minFreePercent) {
    breaches.push(`free ${freePercent.toFixed(1)}% < min ${check.minFreePercent}%`);
  }

  const breached = breaches.length > 0;
  return {
    type: 'disk',
    name,
    status: breached ? 'alert' : 'ok',
    summary: breached
      ? `disk low at ${target}: ${breaches.join('; ')}`
      : `disk ok at ${target}: ${formatBytes(freeBytes)} free (${freePercent.toFixed(1)}%)`,
    details: { path: target, freeBytes, totalBytes, freePercent },
  };
}

async function checkHttp(check: CronWatchdogCheck, name: string): Promise<WatchdogCheckResult> {
  if (!check.url || typeof check.url !== 'string') {
    return { type: 'http', name, status: 'error', summary: 'http check has no url', details: {} };
  }
  const expectStatusBelow = typeof check.expectStatusBelow === 'number' ? check.expectStatusBelow : 400;
  const timeoutMs = typeof check.timeoutMs === 'number' && Number.isFinite(check.timeoutMs)
    ? Math.min(120_000, Math.max(100, Math.trunc(check.timeoutMs)))
    : DEFAULT_HTTP_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(check.url, { method: 'GET', signal: controller.signal });
    const elapsedMs = Date.now() - startedAt;
    const down = response.status >= expectStatusBelow;
    return {
      type: 'http',
      name,
      status: down ? 'alert' : 'ok',
      summary: down
        ? `${check.url} returned ${response.status} (>= ${expectStatusBelow})`
        : `${check.url} ok (${response.status}, ${elapsedMs}ms)`,
      details: { url: check.url, statusCode: response.status, elapsedMs },
    };
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const aborted = controller.signal.aborted;
    return {
      type: 'http',
      name,
      status: 'alert',
      summary: aborted
        ? `${check.url} timed out after ${timeoutMs}ms`
        : `${check.url} unreachable: ${errMsg(err)}`,
      details: { url: check.url, elapsedMs, timedOut: aborted },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkRepo(check: CronWatchdogCheck, name: string): Promise<WatchdogCheckResult> {
  const repoDir = check.repoDir || process.cwd();
  const expectClean = check.expectClean !== false;

  let outcome: { exitCode: number | null; stdout: string; timedOut: boolean };
  try {
    outcome = await spawnCapture('git', ['status', '--porcelain'], { cwd: repoDir, timeoutMs: 30_000 });
  } catch (err) {
    return {
      type: 'repo',
      name,
      status: 'error',
      summary: `git not available or repo invalid at ${repoDir}: ${errMsg(err)}`,
      details: { repoDir },
    };
  }

  if (outcome.exitCode !== 0) {
    return {
      type: 'repo',
      name,
      status: 'error',
      summary: `git status failed at ${repoDir} (exit ${outcome.exitCode})`,
      details: { repoDir, exitCode: outcome.exitCode },
    };
  }

  const changedFiles = outcome.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const dirty = changedFiles.length > 0;
  const breached = expectClean && dirty;
  return {
    type: 'repo',
    name,
    status: breached ? 'alert' : 'ok',
    summary: breached
      ? `repo dirty at ${repoDir}: ${changedFiles.length} uncommitted change(s)`
      : dirty
        ? `repo has ${changedFiles.length} change(s) at ${repoDir} (dirty allowed)`
        : `repo clean at ${repoDir}`,
    details: { repoDir, dirty, changedCount: changedFiles.length },
  };
}

async function checkBuild(
  check: CronWatchdogCheck,
  name: string,
  allowedExecutables: string[] | undefined,
): Promise<WatchdogCheckResult> {
  const command = check.command;
  if (!command || typeof command.executable !== 'string' || command.executable.length === 0) {
    return { type: 'build', name, status: 'error', summary: 'build check has no command', details: {} };
  }
  try {
    assertBuildExecutableAllowed(command.executable, allowedExecutables);
  } catch (err) {
    return {
      type: 'build',
      name,
      status: 'error',
      summary: errMsg(err),
      details: { executable: command.executable },
    };
  }

  let outcome: { exitCode: number | null; stdout: string; timedOut: boolean };
  try {
    outcome = await spawnCapture(command.executable, command.args ?? [], {
      cwd: command.cwd,
      timeoutMs: 600_000,
    });
  } catch (err) {
    return {
      type: 'build',
      name,
      status: 'error',
      summary: `build spawn failed: ${errMsg(err)}`,
      details: { executable: command.executable },
    };
  }

  if (outcome.timedOut) {
    return {
      type: 'build',
      name,
      status: 'alert',
      summary: `build timed out: ${command.executable}`,
      details: { executable: command.executable, timedOut: true },
    };
  }

  const passed = outcome.exitCode === 0;
  return {
    type: 'build',
    name,
    status: passed ? 'ok' : 'alert',
    summary: passed
      ? `build ok: ${command.executable} (exit 0)`
      : `build failed: ${command.executable} (exit ${outcome.exitCode})`,
    details: { executable: command.executable, exitCode: outcome.exitCode },
  };
}

function spawnCapture(
  executable: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
): Promise<{ exitCode: number | null; stdout: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', () => {});
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, timedOut });
    });
  });
}

function assertBuildExecutableAllowed(executable: string, extra: string[] | undefined): void {
  const allowed = new Set([
    ...DEFAULT_BUILD_ALLOWED_EXECUTABLES,
    ...(extra ?? []).map((value) => value.toLowerCase()),
  ]);
  const baseName = path.basename(executable).toLowerCase();
  if (!allowed.has(baseName) && !allowed.has(executable.toLowerCase())) {
    throw new Error(`build executable not allowed: ${executable}`);
  }
}

function buildSummary(
  ok: boolean,
  alerts: number,
  errors: number,
  results: WatchdogCheckResult[],
): string {
  const header = ok
    ? `watchdog ok (${results.length} check${results.length === 1 ? '' : 's'})`
    : `watchdog: ${alerts} alert(s), ${errors} error(s)`;
  const lines = results.map((r) => `  [${r.status}] ${r.name}: ${r.summary}`);
  return [header, ...lines].join('\n');
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)}${units[unit]}`;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
