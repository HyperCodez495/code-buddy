/**
 * LiveLauncherBridge — run `buddy research` / `buddy flow` LIVE from Cowork.
 *
 * The pilotability matrix gated "research / flow live" on a configured
 * provider; the local Ollama ($0) lifts that gate. This bridge spawns the
 * BUILT core CLI as a child process (same doctrine as `spec.next` and
 * `autonomy.runTick`: the CLI owns the workflow, the GUI launches and
 * observes), streams stdout/stderr line-by-line to the renderer as
 * `liveLauncher.event` ServerEvents, supports cancel (SIGTERM→SIGKILL)
 * and a hard timeout, and reads the research report artifact on success.
 *
 * One run at a time — this is a launcher, not a job farm; the fleet saga
 * system is the multi-run surface.
 *
 * @module main/launcher/live-launcher-bridge
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import * as path from 'node:path';
import { resolveCoreEntry } from '../utils/core-loader';
import { resolveNodeBinary } from '../autonomy/autonomy-daemon-bridge';
import { sendToRenderer } from '../ipc-main-bridge';
import { log, logWarn } from '../utils/logger';
import type {
  LiveLauncherEventPayload,
  LiveLauncherRunView,
  LiveLauncherStartInput,
} from '../../shared/live-launcher-types';

const DEFAULT_MODEL = 'qwen2.5:7b-instruct';
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_DIRECT_RESEARCH_TIMEOUT_MS = 300_000;
const DEFAULT_WIDE_RESEARCH_TIMEOUT_MS = 900_000;
const DEFAULT_DEEP_RESEARCH_TIMEOUT_MS = 1_800_000;
const DEFAULT_FLOW_TIMEOUT_MS = 600_000;
/** Grace beyond the CLI's own timeout before we SIGTERM ourselves. */
const TIMEOUT_GRACE_MS = 30_000;
const SIGKILL_GRACE_MS = 5_000;
const LOG_TAIL_CAP = 2_000;
const MAX_KEPT_RUNS = 20;
const MAX_PROMPT_CHARS = 50_000;
const MAX_MODEL_CHARS = 512;
const MAX_OLLAMA_URL_CHARS = 2_048;
const MAX_TIMEOUT_MS = 3_600_000;
const MAX_LOG_LINE_CHARS = 16_384;
const MAX_LOG_TAIL_CHARS = 1_000_000;
const MAX_LOG_EVENT_CHARS = 128_000;
const MAX_RESULT_CHARS = 500_000;

type SendFn = (event: { type: 'liveLauncher.event'; payload: LiveLauncherEventPayload }) => void;

export interface LiveLauncherBridgeOptions {
  send?: SendFn;
  spawnImpl?: typeof spawn;
  spawnSyncImpl?: typeof spawnSync;
  killProcessImpl?: typeof process.kill;
  platform?: NodeJS.Platform;
  /** Where research reports land. Default ~/.codebuddy/research. */
  reportDir?: string;
  readReport?: (reportPath: string) => Promise<string>;
}

function normalizeTimeoutMs(input: number | undefined, fallback: number): number {
  return input !== undefined && Number.isFinite(input) && input > 0
    ? Math.min(Math.trunc(input), MAX_TIMEOUT_MS)
    : fallback;
}

function defaultResearchTimeoutMs(input: LiveLauncherStartInput): number {
  if (input.deep) return DEFAULT_DEEP_RESEARCH_TIMEOUT_MS;
  if (input.wide) return DEFAULT_WIDE_RESEARCH_TIMEOUT_MS;
  return DEFAULT_DIRECT_RESEARCH_TIMEOUT_MS;
}

function capResult(value: string): string {
  if (value.length <= MAX_RESULT_CHARS) return value;
  return `${value.slice(0, MAX_RESULT_CHARS)}\n\n[Output truncated by Cowork after ${MAX_RESULT_CHARS} characters.]`;
}

/** Convert an OpenAI-compatible Ollama base URL into OLLAMA_HOST form. */
function normalizeOllamaHost(value: string): string {
  return value.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

/** Build the CLI argv for a run. Pure — unit-tested. */
export function buildLiveLauncherArgs(
  input: LiveLauncherStartInput,
  runId: string,
  reportDir: string
): { args: string[]; reportPath?: string } {
  const prompt = input.prompt.trim();
  const model = input.model?.trim() || DEFAULT_MODEL;
  if (input.kind === 'research') {
    const reportPath = path.join(reportDir, `cowork-${runId}.md`);
    const timeoutMs = normalizeTimeoutMs(input.timeoutMs, defaultResearchTimeoutMs(input));
    // Mode flags. `--deep` (the deterministic, cited pipeline) takes precedence
    // over `--wide` (parallel workers) — the CLI's `--deep` short-circuits the
    // wide/direct paths, so we never pass both. Default (neither) = the direct
    // single-pass research the bridge has always used.
    const modeArgs: string[] = input.deep
      ? [
          '--deep',
          ...(input.iterations && input.iterations > 1
            ? ['--iterations', String(Math.min(Math.trunc(input.iterations), 5))]
            : []),
          ...(input.perspectives && input.perspectives > 0
            ? ['--perspectives', String(Math.max(2, Math.min(Math.trunc(input.perspectives), 6)))]
            : []),
        ]
      : input.wide
        ? [
            '--wide',
            '--workers',
            String(
              input.workers && input.workers > 0 ? Math.min(Math.trunc(input.workers), 20) : 5
            ),
          ]
        : [];
    return {
      args: [
        'research',
        prompt,
        '--model',
        model,
        '--timeout-ms',
        String(timeoutMs),
        '--report',
        reportPath,
        ...modeArgs,
      ],
      reportPath,
    };
  }
  return {
    args: [
      'flow',
      prompt,
      '--model',
      model,
      '--verbose',
      '--max-retries',
      String(
        input.maxRetries !== undefined && input.maxRetries >= 0
          ? Math.trunc(input.maxRetries)
          : 1
      ),
    ],
  };
}

/** Build the child env for a run. Pure — unit-tested. */
export function buildLiveLauncherEnv(
  input: LiveLauncherStartInput,
  node: { electronAsNode: boolean },
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const configuredOllamaHost =
    input.ollamaUrl?.trim() ||
    baseEnv.OLLAMA_HOST?.trim() ||
    baseEnv.OLLAMA_BASE_URL?.trim() ||
    DEFAULT_OLLAMA_URL;
  return {
    ...baseEnv,
    ...(node.electronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    ...((input.provider ?? 'ollama') === 'ollama'
      ? {
          CODEBUDDY_PROVIDER: 'ollama',
          OLLAMA_HOST: normalizeOllamaHost(configuredOllamaHost) || DEFAULT_OLLAMA_URL,
        }
      : {}),
  };
}

interface ActiveRun {
  view: LiveLauncherRunView;
  child: ChildProcess;
  timeoutTimer: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
  requestedStatus?: 'failed' | 'cancelled';
  requestedError?: string;
}

export class LiveLauncherBridge {
  private readonly send: SendFn;
  private readonly spawnImpl: typeof spawn;
  private readonly spawnSyncImpl: typeof spawnSync;
  private readonly killProcessImpl: typeof process.kill;
  private readonly platform: NodeJS.Platform;
  private readonly reportDir: string;
  private readonly readReport: (reportPath: string) => Promise<string>;
  private readonly runs = new Map<string, LiveLauncherRunView>();
  private active: ActiveRun | null = null;
  private counter = 0;
  private shuttingDown = false;

  constructor(options: LiveLauncherBridgeOptions = {}) {
    this.send = options.send ?? ((event) => sendToRenderer(event as never));
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
    this.killProcessImpl = options.killProcessImpl ?? process.kill.bind(process);
    this.platform = options.platform ?? process.platform;
    this.reportDir = options.reportDir ?? path.join(os.homedir(), '.codebuddy', 'research');
    this.readReport = options.readReport ?? ((p) => fs.readFile(p, 'utf-8'));
  }

  start(input: LiveLauncherStartInput): {
    ok: boolean;
    error?: string;
    runId?: string;
    reportPath?: string;
  } {
    if (this.shuttingDown) {
      return { ok: false, error: 'Cowork is shutting down; new executions are disabled.' };
    }
    if (input?.kind !== 'research' && input?.kind !== 'flow') {
      return { ok: false, error: 'kind must be "research" or "flow".' };
    }
    if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
      return {
        ok: false,
        error:
          input.kind === 'research' ? 'A research topic is required.' : 'A flow goal is required.',
      };
    }
    if (input.prompt.length > MAX_PROMPT_CHARS) {
      return { ok: false, error: `prompt exceeds the ${MAX_PROMPT_CHARS} character limit.` };
    }
    if (input.model !== undefined && (typeof input.model !== 'string' || input.model.length > MAX_MODEL_CHARS)) {
      return { ok: false, error: `model must be a string of at most ${MAX_MODEL_CHARS} characters.` };
    }
    if (input.provider !== undefined && input.provider !== 'ollama' && input.provider !== 'inherit') {
      return { ok: false, error: 'provider must be "ollama" or "inherit".' };
    }
    if ((input.provider ?? 'ollama') === 'inherit' && input.confirmInheritedProvider !== true) {
      return {
        ok: false,
        error: 'Inherited/cloud provider use requires an explicit cost acknowledgement.',
      };
    }
    if (
      (input.wide !== undefined && typeof input.wide !== 'boolean') ||
      (input.deep !== undefined && typeof input.deep !== 'boolean')
    ) {
      return { ok: false, error: 'wide and deep must be booleans when provided.' };
    }
    if (
      input.ollamaUrl !== undefined &&
      (typeof input.ollamaUrl !== 'string' || input.ollamaUrl.length > MAX_OLLAMA_URL_CHARS)
    ) {
      return { ok: false, error: `ollamaUrl must be a string of at most ${MAX_OLLAMA_URL_CHARS} characters.` };
    }
    for (const [name, value] of Object.entries({
      workers: input.workers,
      iterations: input.iterations,
      perspectives: input.perspectives,
      maxRetries: input.maxRetries,
      timeoutMs: input.timeoutMs,
    })) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        return { ok: false, error: `${name} must be a finite non-negative number.` };
      }
    }
    if (this.active) {
      return {
        ok: false,
        error: `A ${this.active.view.kind} run is still active — wait for it to stop or cancel it first.`,
      };
    }
    const entry = resolveCoreEntry();
    if (!entry) {
      return {
        ok: false,
        error: 'Built Code Buddy CLI not found (run `npm run build` in the core repo first).',
      };
    }
    const node = resolveNodeBinary();
    if (!node) {
      return { ok: false, error: 'No node-compatible executable found to run the CLI.' };
    }

    const runId = `ll_${Date.now().toString(36)}_${++this.counter}`;
    const { args, reportPath } = buildLiveLauncherArgs(input, runId, this.reportDir);
    const env = buildLiveLauncherEnv(input, node);
    const timeoutMs =
      normalizeTimeoutMs(
        input.timeoutMs,
        input.kind === 'research' ? defaultResearchTimeoutMs(input) : DEFAULT_FLOW_TIMEOUT_MS
      ) + TIMEOUT_GRACE_MS;

    const view: LiveLauncherRunView = {
      runId,
      kind: input.kind,
      ...(input.kind === 'research'
        ? {
            researchMode: input.deep
              ? ('deep' as const)
              : input.wide
                ? ('wide' as const)
                : ('direct' as const),
          }
        : {}),
      prompt: input.prompt.trim(),
      model: input.model?.trim() || DEFAULT_MODEL,
      provider: input.provider ?? 'ollama',
      ...((input.provider ?? 'ollama') === 'ollama' && env.OLLAMA_HOST
        ? { ollamaUrl: env.OLLAMA_HOST }
        : {}),
      ...(input.kind === 'research' && input.wide
        ? {
            workers:
              input.workers && input.workers > 0 ? Math.min(Math.trunc(input.workers), 20) : 5,
          }
        : {}),
      ...(input.kind === 'research' && input.deep
        ? {
            iterations:
              input.iterations && input.iterations > 0
                ? Math.min(Math.trunc(input.iterations), 5)
                : 1,
            perspectives:
              input.perspectives && input.perspectives > 0
                ? Math.max(2, Math.min(Math.trunc(input.perspectives), 6))
                : 0,
          }
        : {}),
      ...(input.kind === 'flow'
        ? {
            maxRetries:
              input.maxRetries !== undefined && input.maxRetries >= 0
                ? Math.trunc(input.maxRetries)
                : 1,
          }
        : {}),
      timeoutMs: normalizeTimeoutMs(
        input.timeoutMs,
        input.kind === 'research' ? defaultResearchTimeoutMs(input) : DEFAULT_FLOW_TIMEOUT_MS
      ),
      status: 'running',
      startedAt: Date.now(),
      ...(reportPath ? { reportPath } : {}),
      logTail: [],
    };

    let child: ChildProcess;
    try {
      child = this.spawnImpl(node.execPath, [entry, ...args], {
        env,
        detached: this.platform !== 'win32',
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    const timeoutTimer = setTimeout(() => {
      logWarn('[live-launcher] hard timeout — terminating run', { runId });
      this.terminate('failed', `Timed out after ${timeoutMs}ms (launcher hard cap).`);
    }, timeoutMs);
    timeoutTimer.unref?.();

    this.active = { view, child, timeoutTimer };
    this.runs.set(runId, view);
    this.pruneRuns();

    let stdoutRemainder = '';
    let stderrRemainder = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutRemainder = this.ingest(view, 'stdout', stdoutRemainder + chunk.toString('utf-8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrRemainder = this.ingest(view, 'stderr', stderrRemainder + chunk.toString('utf-8'));
    });
    child.on('error', (err) => {
      void this.finishActive(view, null, err.message, { stdoutRemainder, stderrRemainder });
    });
    child.on('close', (code) => {
      void this.finishActive(view, code, undefined, { stdoutRemainder, stderrRemainder });
    });

    log('[live-launcher] started', { runId, kind: input.kind, model: view.model });
    this.emitStatus(view);
    return { ok: true, runId, ...(reportPath ? { reportPath } : {}) };
  }

  cancel(runId: string): { ok: boolean; error?: string } {
    if (!this.active || this.active.view.runId !== runId) {
      return { ok: false, error: `No active run with id '${runId}'.` };
    }
    if (this.active.view.status !== 'running') {
      return {
        ok: false,
        error: `Run '${runId}' is already terminal ('${this.active.view.status}').`,
      };
    }
    if (this.active.requestedStatus) {
      return { ok: false, error: `Run '${runId}' is already stopping.` };
    }
    this.terminate('cancelled', 'Cancelled by operator.');
    return { ok: true };
  }

  status(runId: string): LiveLauncherRunView | null {
    const run = this.runs.get(runId);
    return run ? { ...run, logTail: [...run.logTail] } : null;
  }

  list(): LiveLauncherRunView[] {
    return Array.from(this.runs.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((run) => {
        const { logTail, result, ...summary } = run;
        return {
          ...summary,
          logTail: [],
          logLineCount: logTail.length,
          hasResult: result !== undefined,
        };
      });
  }

  /** Synchronous app-shutdown guard: do not leave the launcher child behind. */
  shutdown(): void {
    this.shuttingDown = true;
    const active = this.active;
    if (!active) return;
    clearTimeout(active.timeoutTimer);
    if (active.killTimer) clearTimeout(active.killTimer);
    active.view.status = 'cancelled';
    active.view.error = 'Cowork shut down while this execution was running.';
    active.view.endedAt = Date.now();
    this.active = null;
    this.terminateProcessTree(active.child, 'SIGKILL');
  }

  // ── internals ────────────────────────────────────────────────────────

  /** Split buffered text into complete lines; emit + tail them; return the remainder. */
  private ingest(view: LiveLauncherRunView, stream: 'stdout' | 'stderr', buffered: string): string {
    const parts = buffered.split('\n');
    let remainder = parts.pop() ?? '';
    const lines = parts
      .map((line) => line.replace(/\r$/, ''))
      .filter((line) => line.length > 0)
      .map((line) =>
        line.length > MAX_LOG_LINE_CHARS
          ? `${line.slice(0, MAX_LOG_LINE_CHARS)}… [line truncated]`
          : line
      );
    if (remainder.length > MAX_LOG_LINE_CHARS) {
      lines.push(`${remainder.slice(0, MAX_LOG_LINE_CHARS)}… [line truncated]`);
      remainder = '';
    }
    if (lines.length > 0) {
      view.logTail.push(...lines);
      let tailChars = view.logTail.reduce((total, line) => total + line.length, 0);
      while (view.logTail.length > LOG_TAIL_CAP || tailChars > MAX_LOG_TAIL_CHARS) {
        tailChars -= view.logTail.shift()?.length ?? 0;
      }
      const emittedLines: string[] = [];
      let emittedChars = 0;
      for (const line of lines) {
        if (emittedChars + line.length > MAX_LOG_EVENT_CHARS) {
          emittedLines.push('[additional live output omitted; retained tail is available via status]');
          break;
        }
        emittedLines.push(line);
        emittedChars += line.length;
      }
      this.send({
        type: 'liveLauncher.event',
        payload: { runId: view.runId, kind: 'log', stream, lines: emittedLines },
      });
    }
    return remainder;
  }

  /** SIGTERM the active child (SIGKILL after a grace), pre-setting the terminal status. */
  private terminate(status: 'failed' | 'cancelled', reason: string): void {
    const active = this.active;
    if (!active || active.view.status !== 'running' || active.requestedStatus) return;
    active.requestedStatus = status;
    active.requestedError = reason;
    this.terminateProcessTree(active.child, 'SIGTERM');
    active.killTimer = setTimeout(() => {
      this.terminateProcessTree(active.child, 'SIGKILL');
    }, SIGKILL_GRACE_MS);
    active.killTimer.unref?.();
  }

  /** Kill the complete launcher tree, not only the CLI parent process. */
  private terminateProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
    const pid = child.pid;
    if (!pid) {
      try {
        child.kill(signal);
      } catch {
        /* already dead */
      }
      return;
    }

    if (this.platform === 'win32') {
      try {
        const killed = this.spawnSyncImpl('taskkill', ['/pid', String(pid), '/t', '/f'], {
          stdio: 'ignore',
          timeout: 5_000,
          windowsHide: true,
          shell: false,
        });
        if (killed.status === 0) return;
      } catch {
        /* fall back to the direct child handle */
      }
    } else {
      try {
        this.killProcessImpl(-pid, signal);
        return;
      } catch {
        /* fall back to the direct child handle */
      }
    }

    try {
      child.kill(signal);
    } catch {
      /* already dead */
    }
  }

  private async finishActive(
    view: LiveLauncherRunView,
    exitCode: number | null,
    spawnError: string | undefined,
    remainders: { stdoutRemainder: string; stderrRemainder: string }
  ): Promise<void> {
    const active = this.active;
    if (active?.view.runId !== view.runId) return;
    clearTimeout(active.timeoutTimer);
    if (active.killTimer) clearTimeout(active.killTimer);
    this.active = null;

    // Flush trailing partial lines so the last output isn't lost.
    if (remainders.stdoutRemainder.trim())
      this.ingest(view, 'stdout', `${remainders.stdoutRemainder}\n`);
    if (remainders.stderrRemainder.trim())
      this.ingest(view, 'stderr', `${remainders.stderrRemainder}\n`);

    view.endedAt = Date.now();
    if (exitCode !== null) view.exitCode = exitCode;

    if (active.requestedStatus) {
      view.status = active.requestedStatus;
      view.error = active.requestedError;
    } else {
      if (spawnError) {
        view.status = 'failed';
        view.error = spawnError;
      } else if (exitCode === 0) {
        view.status = 'succeeded';
        if (view.kind === 'research' && view.reportPath) {
          try {
            view.result = capResult(await this.readReport(view.reportPath));
          } catch (err) {
            // Report unreadable — fall back to the log tail, stay honest.
            view.result = capResult(view.logTail.join('\n'));
            logWarn('[live-launcher] report unreadable, falling back to log tail', {
              runId: view.runId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        } else {
          view.result = capResult(view.logTail.join('\n'));
        }
      } else {
        view.status = 'failed';
        view.error =
          `CLI exited with code ${exitCode}. ${view.logTail.slice(-5).join(' | ')}`.trim();
      }
    }

    log('[live-launcher] finished', { runId: view.runId, status: view.status, exitCode });
    this.emitStatus(view);
  }

  private emitStatus(view: LiveLauncherRunView): void {
    this.send({
      type: 'liveLauncher.event',
      payload: { runId: view.runId, kind: 'status', run: { ...view, logTail: [...view.logTail] } },
    });
  }

  private pruneRuns(): void {
    if (this.runs.size <= MAX_KEPT_RUNS) return;
    const oldest = Array.from(this.runs.values())
      .filter((run) => run.status !== 'running')
      .sort((a, b) => a.startedAt - b.startedAt);
    for (const run of oldest.slice(0, this.runs.size - MAX_KEPT_RUNS)) {
      this.runs.delete(run.runId);
    }
  }
}
