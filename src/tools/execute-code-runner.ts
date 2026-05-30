import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

export type ExecuteCodeLanguage = 'javascript' | 'typescript' | 'python' | 'shell';

export interface ExecuteCodeInput {
  code: string;
  language?: ExecuteCodeLanguage;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ExecuteCodeRunnerOptions {
  rootDir?: string;
  now?: () => Date;
  createId?: () => string;
}

export interface ExecuteCodeResult {
  kind: 'execute_code_result';
  ok: boolean;
  runId: string;
  language: ExecuteCodeLanguage;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  commandPreview: string;
  runDir: string;
  scriptPath: string;
  stdoutPath: string;
  stderrPath: string;
  resultPath: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  files: string[];
  error?: string;
}

interface Invocation {
  command: string;
  args: string[];
  commandPreview: string;
  extension: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_CAPTURE_CHARS = 1_000_000;
const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function executeCode(
  input: ExecuteCodeInput,
  options: ExecuteCodeRunnerOptions = {},
): Promise<ExecuteCodeResult> {
  const code = parseCode(input.code);
  const language = input.language ?? 'javascript';
  const timeoutMs = clampTimeout(input.timeoutMs);
  const startedAtDate = (options.now ?? (() => new Date()))();
  const startedAt = startedAtDate.toISOString();
  const startTime = Date.now();
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const runId = sanitizeRunId(options.createId?.() ?? `exec-${randomUUID()}`);
  const runDir = path.join(rootDir, '.codebuddy', 'execute-code', runId);
  const stdoutPath = path.join(runDir, 'stdout.log');
  const stderrPath = path.join(runDir, 'stderr.log');
  const resultPath = path.join(runDir, 'result.json');
  const invocation = buildInvocation(language);
  const scriptPath = path.join(runDir, `script${invocation.extension}`);
  const scriptArgs = parseArgs(input.args);
  const env = parseEnv(input.env);

  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(scriptPath, code, 'utf8');
  if (language === 'shell' && process.platform !== 'win32') {
    await fs.chmod(scriptPath, 0o700);
  }

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let spawnError: Error | undefined;

  const completed = await new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
    const child = spawn(invocation.command, [...invocation.args, scriptPath, ...scriptArgs], {
      cwd: runDir,
      env: {
        ...process.env,
        ...env,
        CODEBUDDY_EXECUTE_CODE_RUN_DIR: runDir,
        CODEBUDDY_WORKSPACE_ROOT: rootDir,
      },
      windowsHide: true,
    });

    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 1_000);
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk.toString('utf8'));
    });
    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({ exitCode, signal });
    });
  });

  const completedAt = (options.now ?? (() => new Date()))().toISOString();
  const durationMs = Math.max(0, Date.now() - startTime);
  await fs.writeFile(stdoutPath, stdout, 'utf8');
  await fs.writeFile(stderrPath, stderr, 'utf8');

  const error = buildError(spawnError, timedOut, completed.exitCode, timeoutMs);
  const filesBeforeResult = await listRunFiles(runDir);
  const result: ExecuteCodeResult = {
    kind: 'execute_code_result',
    ok: !error,
    runId,
    language,
    startedAt,
    completedAt,
    durationMs,
    commandPreview: `${invocation.commandPreview} ${scriptArgs.map(quoteArg).join(' ')}`.trim(),
    runDir,
    scriptPath,
    stdoutPath,
    stderrPath,
    resultPath,
    exitCode: completed.exitCode,
    signal: completed.signal,
    timedOut,
    stdout,
    stderr,
    files: [...new Set([...filesBeforeResult, 'result.json'])].sort(),
    ...(error ? { error } : {}),
  };
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

function parseCode(code: unknown): string {
  if (typeof code !== 'string' || !code.trim()) {
    throw new Error('code is required');
  }
  if (code.length > 200_000) {
    throw new Error('code is too large for execute_code; use a checked-in script plus terminal for larger jobs');
  }
  return code;
}

function parseArgs(args: unknown): string[] {
  if (args === undefined) return [];
  if (!Array.isArray(args)) {
    throw new Error('args must be an array of strings');
  }
  return args.map((arg, index) => {
    if (typeof arg !== 'string') {
      throw new Error(`args[${index}] must be a string`);
    }
    return arg;
  });
}

function parseEnv(env: unknown): Record<string, string> {
  if (env === undefined) return {};
  if (typeof env !== 'object' || env === null || Array.isArray(env)) {
    throw new Error('env must be an object of string values');
  }
  const parsed: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!VALID_ENV_KEY.test(key)) {
      throw new Error(`Invalid env key: ${key}`);
    }
    if (typeof value !== 'string') {
      throw new Error(`env.${key} must be a string`);
    }
    parsed[key] = value;
  }
  return parsed;
}

function clampTimeout(timeoutMs: unknown): number {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
    throw new Error('timeout_ms must be a finite number');
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.floor(timeoutMs)));
}

function buildInvocation(language: ExecuteCodeLanguage): Invocation {
  switch (language) {
    case 'javascript':
      return {
        command: process.execPath,
        args: [],
        commandPreview: 'node script.mjs',
        extension: '.mjs',
      };
    case 'typescript':
      return {
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: ['tsx'],
        commandPreview: 'npx tsx script.ts',
        extension: '.ts',
      };
    case 'python':
      return {
        command: process.platform === 'win32' ? 'python.exe' : 'python3',
        args: [],
        commandPreview: 'python script.py',
        extension: '.py',
      };
    case 'shell':
      if (process.platform === 'win32') {
        return {
          command: 'powershell.exe',
          args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'],
          commandPreview: 'powershell -File script.ps1',
          extension: '.ps1',
        };
      }
      return {
        command: 'sh',
        args: [],
        commandPreview: 'sh script.sh',
        extension: '.sh',
      };
  }
}

function appendBounded(current: string, next: string): string {
  const combined = current + next;
  if (combined.length <= MAX_CAPTURE_CHARS) {
    return combined;
  }
  return combined.slice(combined.length - MAX_CAPTURE_CHARS);
}

function buildError(
  spawnError: Error | undefined,
  timedOut: boolean,
  exitCode: number | null,
  timeoutMs: number,
): string | undefined {
  if (spawnError) return spawnError.message;
  if (timedOut) return `execute_code timed out after ${timeoutMs}ms`;
  if (exitCode !== 0) return `execute_code exited with code ${exitCode ?? 'unknown'}`;
  return undefined;
}

function sanitizeRunId(runId: string): string {
  const sanitized = runId.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || `exec-${randomUUID()}`;
}

async function listRunFiles(runDir: string): Promise<string[]> {
  const entries = await fs.readdir(runDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function quoteArg(arg: string): string {
  if (!arg) return '""';
  return /\s/.test(arg) ? JSON.stringify(arg) : arg;
}
