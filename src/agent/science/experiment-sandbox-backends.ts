/**
 * AI-Scientist-lite — Phase 2 real-brick sandbox adapters.
 *
 * Thin adapters that BRANCH the existing `src/sandbox/*` backends (never modify
 * them) and translate their result shape into the {@link ExecuteCodeResult}
 * the orchestrator already understands. Loaded lazily by the router only when a
 * containerised backend is actually selected AND available.
 *
 *   - {@link runInDocker} → `DockerSandbox` with `networkEnabled:false`, i.e.
 *     `docker run --network none`. THE security property: the network is cut.
 *     The docker executor is injectable so tests assert the isolation option
 *     without a real Docker daemon.
 *   - {@link runInE2b} → `E2BSandbox.runScript`, an off-host Firecracker microVM.
 *     The `runScript` boundary is injectable so tests assert routing without a
 *     real E2B account.
 *
 * @module agent/science/experiment-sandbox-backends
 */

import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import type {
  ExecuteCodeInput,
  ExecuteCodeLanguage,
  ExecuteCodeResult,
  ExecuteCodeRunnerOptions,
} from '../../tools/execute-code-runner.js';
import type { SandboxConfig, SandboxResult } from '../../sandbox/docker-sandbox.js';
import type { E2BSandboxResult } from '../../sandbox/e2b-sandbox.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_CAPTURE_CHARS = 1_000_000;

/** Per-language container image + how the script is written and invoked. */
interface LanguageSpec {
  /** Container image with the interpreter (network-cut, so nothing is fetched). */
  image: string;
  /** Script file extension. */
  ext: string;
  /** Command run inside the container against the mounted script path. */
  command: (containerScriptPath: string) => string;
}

/**
 * Images are chosen so the interpreter is PRESENT (the network is cut, so no
 * runtime download is possible). python/javascript work offline out of the box;
 * typescript relies on `npx tsx`, which needs a network or a pre-baked image —
 * an honest limitation of the network-cut docker backend (documented).
 */
const LANGUAGE_SPEC: Readonly<Record<ExecuteCodeLanguage, LanguageSpec>> = {
  python: { image: 'python:3.12-slim', ext: '.py', command: (p) => `python ${p}` },
  javascript: { image: 'node:22-slim', ext: '.mjs', command: (p) => `node ${p}` },
  typescript: { image: 'node:22-slim', ext: '.ts', command: (p) => `npx --yes tsx ${p}` },
  shell: { image: 'node:22-slim', ext: '.sh', command: (p) => `sh ${p}` },
};

// ============================================================================
// Docker adapter — network CUT (`--network none`)
// ============================================================================

/** Injectable edges for {@link runInDocker} (real defaults resolved lazily). */
export interface DockerBackendDeps {
  /**
   * The docker executor. Default: a fresh `DockerSandbox().execute`. Injected in
   * tests to assert the isolation options (crucially `networkEnabled:false`).
   */
  dockerExecute?: (command: string, opts: Partial<SandboxConfig>) => Promise<SandboxResult>;
  now?: () => Date;
  createId?: () => string;
}

/**
 * Run the experiment script inside a Docker container with the network CUT.
 *
 * The script is staged on the host under `<rootDir>/.codebuddy/execute-code/<id>`
 * and bind-mounted at `/workspace`, so the container needs no network to obtain
 * the code. `networkEnabled:false` makes `DockerSandbox` emit `--network none`.
 */
export async function runInDocker(
  input: ExecuteCodeInput,
  options: ExecuteCodeRunnerOptions,
  deps: DockerBackendDeps = {},
): Promise<ExecuteCodeResult> {
  const language: ExecuteCodeLanguage = input.language ?? 'javascript';
  const spec = LANGUAGE_SPEC[language];
  const now = deps.now ?? options.now ?? (() => new Date());
  const createId = deps.createId ?? options.createId ?? (() => `dkr-${randomUUID()}`);
  const timeoutMs = clampTimeout(input.timeoutMs);
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const runId = sanitizeRunId(createId());
  const runDir = path.join(rootDir, '.codebuddy', 'execute-code', runId);
  const scriptName = `script${spec.ext}`;
  const scriptPath = path.join(runDir, scriptName);
  const stdoutPath = path.join(runDir, 'stdout.log');
  const stderrPath = path.join(runDir, 'stderr.log');
  const resultPath = path.join(runDir, 'result.json');

  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(scriptPath, requireCode(input.code), 'utf8');

  const containerScriptPath = `/workspace/${scriptName}`;
  const command = spec.command(containerScriptPath);
  const startedAt = now().toISOString();

  const dockerExecute = deps.dockerExecute ?? (await resolveDefaultDockerExecute());
  // ── SECURITY: networkEnabled:false → `docker run --network none` ──────────
  const sandboxResult = await dockerExecute(command, {
    image: spec.image,
    workspaceMount: runDir,
    timeout: timeoutMs,
    networkEnabled: false,
    readOnly: false,
  });

  const completedAt = now().toISOString();
  const stdout = boundText(sandboxResult.output ?? '');
  const timedOut = /timed out/i.test(sandboxResult.error ?? '');
  const stderr = timedOut ? '' : boundText(sandboxResult.error ?? '');
  const exitCode = typeof sandboxResult.exitCode === 'number' ? sandboxResult.exitCode : null;
  const ok = sandboxResult.success === true && !timedOut;
  const error = buildError(ok, timedOut, exitCode, timeoutMs);

  await fs.writeFile(stdoutPath, stdout, 'utf8').catch(() => undefined);
  await fs.writeFile(stderrPath, stderr, 'utf8').catch(() => undefined);
  const files = await listRunFiles(runDir);

  const result: ExecuteCodeResult = {
    kind: 'execute_code_result',
    ok,
    runId,
    language,
    startedAt,
    completedAt,
    durationMs: Math.max(0, sandboxResult.durationMs ?? 0),
    commandPreview: `[docker --network none ${spec.image}] ${command}`,
    runDir,
    scriptPath,
    stdoutPath,
    stderrPath,
    resultPath,
    exitCode,
    signal: null,
    timedOut,
    stdout,
    stderr,
    files: [...new Set([...files, 'result.json'])].sort(),
    ...(error ? { error } : {}),
  };
  await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8').catch(() => undefined);
  return result;
}

async function resolveDefaultDockerExecute(): Promise<
  (command: string, opts: Partial<SandboxConfig>) => Promise<SandboxResult>
> {
  const { DockerSandbox } = await import('../../sandbox/docker-sandbox.js');
  const sandbox = new DockerSandbox();
  return (command, opts) => sandbox.execute(command, opts);
}

// ============================================================================
// E2B adapter — off-host microVM (host isolated; network NOT cut)
// ============================================================================

/** Injectable edges for {@link runInE2b} (real defaults resolved lazily). */
export interface E2bBackendDeps {
  /**
   * Runs a script in the E2B microVM. Default: `getE2BSandbox().runScript`.
   * Injected in tests to assert routing without a real E2B account.
   */
  runScript?: (code: string, language: ExecuteCodeLanguage) => Promise<E2BSandboxResult>;
  now?: () => Date;
  createId?: () => string;
}

/**
 * Run the experiment script inside an E2B Firecracker microVM. The host
 * filesystem/secrets are unreachable (off-host), but the microVM keeps outbound
 * network — the router discloses this and never lets e2b satisfy
 * `requireNetworkIsolation`.
 */
export async function runInE2b(
  input: ExecuteCodeInput,
  options: ExecuteCodeRunnerOptions,
  deps: E2bBackendDeps = {},
): Promise<ExecuteCodeResult> {
  const language: ExecuteCodeLanguage = input.language ?? 'javascript';
  const now = deps.now ?? options.now ?? (() => new Date());
  const createId = deps.createId ?? options.createId ?? (() => `e2b-${randomUUID()}`);
  const runId = sanitizeRunId(createId());
  const startedAt = now().toISOString();

  const runScript = deps.runScript ?? (await resolveDefaultE2bRunScript());
  const r = await runScript(requireCode(input.code), language);

  const completedAt = now().toISOString();
  const stdout = boundText(r.output ?? '');
  const timedOut = /timeout|aborted/i.test(r.error ?? '');
  const stderr = timedOut ? '' : boundText(r.error ?? '');
  const exitCode = typeof r.exitCode === 'number' ? r.exitCode : null;
  const ok = r.success === true && !timedOut;
  const error = buildError(ok, timedOut, exitCode, clampTimeout(input.timeoutMs));
  // E2B runs off-host — there is no host run directory; the paths are virtual.
  const base = `e2b://${r.sandboxId ?? runId}`;

  return {
    kind: 'execute_code_result',
    ok,
    runId,
    language,
    startedAt,
    completedAt,
    durationMs: Math.max(0, r.durationMs ?? 0),
    commandPreview: `[e2b microVM] script.${LANGUAGE_SPEC[language].ext.replace('.', '')}`,
    runDir: base,
    scriptPath: `${base}/script${LANGUAGE_SPEC[language].ext}`,
    stdoutPath: `${base}/stdout.log`,
    stderrPath: `${base}/stderr.log`,
    resultPath: `${base}/result.json`,
    exitCode,
    signal: null,
    timedOut,
    stdout,
    stderr,
    files: [],
    ...(error ? { error } : {}),
  };
}

async function resolveDefaultE2bRunScript(): Promise<
  (code: string, language: ExecuteCodeLanguage) => Promise<E2BSandboxResult>
> {
  const { getE2BSandbox } = await import('../../sandbox/e2b-sandbox.js');
  const sandbox = getE2BSandbox();
  return (code, language) => sandbox.runScript(code, language);
}

// ============================================================================
// Shared helpers (kept local — the isolate runner's are private)
// ============================================================================

function requireCode(code: unknown): string {
  return typeof code === 'string' ? code : '';
}

function clampTimeout(timeoutMs: unknown): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(timeoutMs)));
}

function boundText(text: string): string {
  return text.length <= MAX_CAPTURE_CHARS ? text : text.slice(text.length - MAX_CAPTURE_CHARS);
}

function buildError(ok: boolean, timedOut: boolean, exitCode: number | null, timeoutMs: number): string | undefined {
  if (ok) return undefined;
  if (timedOut) return `experiment timed out after ${timeoutMs}ms`;
  return `experiment exited with code ${exitCode ?? 'unknown'}`;
}

function sanitizeRunId(runId: string): string {
  const sanitized = runId.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || `run-${randomUUID()}`;
}

async function listRunFiles(runDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(runDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}
