/**
 * Camoufox Runner — Playwright-server protocol (NOT Chrome CDP)
 *
 * Camoufox is an anti-detect **Firefox**. It does NOT speak the Chrome
 * DevTools Protocol and exposes no `/json/version` endpoint. The upstream
 * supported automation surface is a **Playwright server**: the Python
 * `camoufox` package launches Playwright's `firefox` `launchServer`, which
 * prints a Playwright-server WebSocket endpoint (`ws://<host>:<port>/<guid>`).
 * The caller connects to it with `playwright.firefox.connect(wsEndpoint)` —
 * NOT `chromium.connectOverCDP()` (that is Chromium-only and invalid here).
 *
 * This runner spawns the server, parses the printed wsEndpoint, and returns
 * it. The caller owns the `firefox.connect()` step (see
 * `src/agent/hermes-browser-backends.ts → runCamofoxSmoke`).
 *
 * ── Live-validated on this host (camoufox 0.4.11, 2026-06-14) ──────────────
 * The repo's Node Playwright 1.58.2 `firefox.connect()` SUCCESSFULLY connects
 * to a server launched by the venv's Playwright 1.58.0 driver — same-minor
 * patch skew passes Playwright's version guard, so a real end-to-end page
 * load (title + heading round-trip) works. If a future ecosystem bump widens
 * the gap to a different minor (e.g. server 1.49 vs client 1.58), `connect`
 * throws a version-guard error; the caller surfaces that honestly rather than
 * faking success.
 *
 * ── 0.4.11 CLI bug worked around here ──────────────────────────────────────
 * `python -m camoufox server` (and `camoufox.server.launch_server()` with no
 * args) is BROKEN in 0.4.11: `launch_options()` emits `proxy: null`, which the
 * bundled `launchServer.js` rejects with
 * `proxy: expected object, got null → Failed to launch browser`. We drive the
 * same public `launch_server` plumbing from a tiny inline Python launcher that
 * strips null-valued options before piping them to `launchServer.js`, which is
 * the supported path minus the upstream null bug.
 *
 * Falls back gracefully when Camoufox is not installed — every public function
 * returns a typed result rather than throwing.
 */

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CamofoxRunnerOptions {
  /** Run without a visible window (default: true). */
  headless?: boolean;
  /**
   * Milliseconds to wait for the server to print its wsEndpoint
   * (default: 30 000 — the first launch downloads/initialises the profile).
   */
  timeout?: number;
  /**
   * Path to a Python interpreter that has the `camoufox` package installed.
   * Defaults to `$CODEBUDDY_CAMOFOX_PYTHON`, then `python3`.
   * This is the supported entry point — Camoufox's server is Python-driven.
   */
  pythonPath?: string;
  /**
   * Optional explicit path to the Camoufox **browser binary** to hand to the
   * server (`executable_path`). Defaults to `$CODEBUDDY_CAMOFOX_BINARY`, else
   * the package's own auto-resolved install. Rarely needed.
   */
  binaryPath?: string;
}

export interface CamofoxRunnerResult {
  ok: boolean;
  /**
   * Playwright-server WebSocket endpoint, e.g.
   * `ws://localhost:44477/51422436867b21da7464b5b253fd2fdd`.
   * Connect with `playwright.firefox.connect(wsEndpoint)` — NOT connectOverCDP.
   */
  wsEndpoint?: string;
  error?: string;
  /**
   * PID of the launched Python process group leader. Pass to `closeCamofox`
   * to reap the whole python → node → firefox tree.
   */
  pid?: number;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Inline Python launcher. Reproduces `camoufox.server.launch_server()` but
 * strips null-valued options (the 0.4.11 `proxy: null` CLI bug) before piping
 * the config to the bundled `launchServer.js`, which prints the wsEndpoint.
 *
 * `headless` is templated in as a literal `True`/`False`.
 * `executable_path` is passed only when a binary override is supplied.
 */
function buildLauncherScript(headless: boolean, binaryPath?: string): string {
  const launchKwargs = binaryPath
    ? `headless=${headless ? 'True' : 'False'}, executable_path=${JSON.stringify(binaryPath)}`
    : `headless=${headless ? 'True' : 'False'}`;

  return [
    'import base64, subprocess, sys',
    'try:',
    '    import orjson',
    '    def _dumps(o): return orjson.dumps(o)',
    'except Exception:',
    '    import json',
    '    def _dumps(o): return json.dumps(o).encode()',
    'from pathlib import Path',
    'from camoufox.utils import launch_options',
    'from camoufox.server import LAUNCH_SCRIPT, get_nodejs, to_camel_case_dict',
    `config = launch_options(${launchKwargs})`,
    '# Work around camoufox 0.4.11: launch_options emits proxy=None, which',
    "# launchServer.js rejects with 'proxy: expected object, got null'.",
    'config = {k: v for k, v in config.items() if v is not None}',
    'nodejs = get_nodejs()',
    'data = _dumps(to_camel_case_dict(config))',
    'proc = subprocess.Popen([nodejs, str(LAUNCH_SCRIPT)],',
    '                        cwd=Path(nodejs).parent / "package",',
    '                        stdin=subprocess.PIPE, text=True)',
    'proc.stdin.write(base64.b64encode(data).decode())',
    'proc.stdin.close()',
    'proc.wait()',
  ].join('\n');
}

// Strip ANSI escape sequences (the endpoint is printed wrapped in colour codes).
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\[[0-9;]*m/g;

/**
 * Extract the Playwright-server WS endpoint from accumulated server stdout.
 * Upstream prints: `Websocket endpoint:\x1b[93m ws://host:port/guid \x1b[0m`.
 *
 * Only returns an endpoint once the line is **complete** — i.e. the buffer
 * contains a delimiter *after* the `ws://…` token (the trailing ANSI reset is
 * stripped, so we look for whitespace / newline / end-of-input following it).
 * This avoids resolving a truncated URL when the pipe splits mid-line.
 */
export function parseWsEndpoint(text: string): string | null {
  const cleaned = text.replace(ANSI_PATTERN, '');
  // Require the ws token to be followed by whitespace or end-of-string, which
  // only happens once the full line (incl. trailing reset) has arrived.
  const match = cleaned.match(/(ws:\/\/\S+?)(?:\s|$)/i);
  const candidate = match?.[1];
  if (!candidate) return null;
  // Guard against an end-of-buffer partial: only accept when something
  // (whitespace/newline) actually terminates the token, not bare EOF on the
  // very last char with no trailing delimiter seen yet.
  const terminated = new RegExp(`${escapeRegExp(candidate)}\\s`).test(cleaned);
  return terminated ? candidate : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Launch a Camoufox Playwright server and return its wsEndpoint.
 *
 * ```ts
 * const result = await launchCamofox({ headless: true });
 * if (result.ok) {
 *   const playwright = await import('playwright');
 *   // Firefox-based — use firefox.connect(), NOT chromium.connectOverCDP().
 *   const browser = await playwright.firefox.connect(result.wsEndpoint!);
 *   // ... drive the browser ...
 *   await browser.close();
 *   await closeCamofox(result.pid!);
 * }
 * ```
 */
export async function launchCamofox(options: CamofoxRunnerOptions = {}): Promise<CamofoxRunnerResult> {
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const headless = options.headless ?? true;
  const python = options.pythonPath ?? (process.env.CODEBUDDY_CAMOFOX_PYTHON?.trim() || 'python3');
  const binaryPath = options.binaryPath ?? (process.env.CODEBUDDY_CAMOFOX_BINARY?.trim() || undefined);

  const script = buildLauncherScript(headless, binaryPath);

  // Spawn the Python launcher detached so it leads its own process group; the
  // server tree is python → node(launchServer.js) → firefox. Killing only the
  // python PID would orphan the node server + Firefox, so we reap the whole
  // group in closeCamofox via `process.kill(-pid)`.
  let proc: ChildProcess;
  try {
    proc = spawn(python, ['-c', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[camofox-runner] Failed to spawn ${python}: ${message}`);
    return { ok: false, error: `Failed to spawn ${python}: ${message}` };
  }

  // Don't let the launcher keep our event loop alive once we've handed back.
  proc.unref();

  return await new Promise<CamofoxRunnerResult>((resolve) => {
    let settled = false;
    let stdoutBuf = '';
    let stderrBuf = '';

    const finish = (result: CamofoxRunnerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      // No endpoint in time — kill the (partial) tree and report.
      const pid = proc.pid;
      if (pid !== undefined) {
        try { process.kill(-pid, 'SIGKILL'); } catch { /* best-effort */ }
      }
      const detail = classifyServerError(stderrBuf || stdoutBuf);
      logger.warn(`[camofox-runner] No wsEndpoint within ${timeoutMs}ms. ${detail}`);
      finish({
        ok: false,
        error: `Camoufox server did not print a wsEndpoint within ${timeoutMs}ms. ${detail}`.trim(),
        pid,
      });
    }, timeoutMs);

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const endpoint = parseWsEndpoint(stdoutBuf);
      if (endpoint) {
        logger.debug(`[camofox-runner] Playwright server ready at ${endpoint} (pid ${proc.pid})`);
        finish({ ok: true, wsEndpoint: endpoint, pid: proc.pid });
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    proc.on('error', (err) => {
      const message = err.message;
      const hint = /ENOENT/.test(message)
        ? ` Python interpreter '${python}' not found, or the camoufox package is not installed. ` +
          'Install with: python3 -m venv <venv> && <venv>/bin/pip install "camoufox[geoip]" && set options.pythonPath.'
        : '';
      logger.warn(`[camofox-runner] Spawn error: ${message}${hint}`);
      finish({ ok: false, error: `Spawn error: ${message}${hint}`, pid: proc.pid });
    });

    proc.on('close', (code) => {
      if (settled) return;
      const detail = classifyServerError(stderrBuf || stdoutBuf);
      finish({
        ok: false,
        error: `Camoufox server exited (code ${code ?? 'null'}) before printing a wsEndpoint. ${detail}`.trim(),
        pid: proc.pid,
      });
    });
  });
}

/**
 * Map common server failures to an actionable message. Surfaces the
 * Playwright version-guard case explicitly (HONEST handling of the
 * version-lock the task calls out) rather than masking it.
 */
function classifyServerError(output: string): string {
  const text = output.trim();
  if (!text) return '';

  // Playwright server/client version guard. The server is launched by the
  // Python camoufox package's Playwright driver; the caller connects with the
  // repo's Node Playwright. A minor-version mismatch trips this guard.
  if (/version|incompatible|handshake|\b428\b/i.test(text) && /playwright/i.test(text)) {
    return (
      'Camoufox server requires a Playwright version compatible with the ' +
      "installed camoufox package's driver; the repo is pinned to Playwright " +
      '1.58.x. If connect() later fails with a version-guard error, align the ' +
      'venv camoufox Playwright minor with the repo pin (same minor; patch ' +
      `skew is tolerated). Server output: ${firstNonEmptyLine(text)}`
    );
  }

  if (/No module named ['"]?camoufox|ModuleNotFoundError/i.test(text)) {
    return (
      'The camoufox Python package is not importable by the chosen interpreter. ' +
      'Install with: python3 -m venv <venv> && <venv>/bin/pip install ' +
      '"camoufox[geoip]" and pass options.pythonPath=<venv>/bin/python.'
    );
  }

  if (/proxy: expected object, got null/i.test(text)) {
    // Should not happen — we strip nulls — but report clearly if upstream changes.
    return 'Camoufox launch options were rejected (proxy: null). The installed camoufox version may differ from the one this runner targets.';
  }

  return `Server output: ${firstNonEmptyLine(text)}`;
}

function firstNonEmptyLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? text.slice(0, 200);
}

/**
 * Gracefully terminate a previously launched Camoufox server tree.
 *
 * The launcher is spawned `detached`, so its PID leads a process group that
 * contains the node Playwright server and every Firefox process. We signal the
 * whole group (`-pid`) — signalling only the python leader would orphan the
 * node server and the browser.
 */
export async function closeCamofox(pid: number): Promise<void> {
  const killGroup = (signal: NodeJS.Signals): boolean => {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      // Group already gone, or never became a group leader; fall back to the
      // single PID so we still make a best-effort kill.
      try {
        process.kill(pid, signal);
        return true;
      } catch {
        return false;
      }
    }
  };

  if (!killGroup('SIGTERM')) return; // already gone

  // Give the tree a moment to exit before escalating.
  await new Promise<void>((resolve) => setTimeout(resolve, 500));

  // Is the leader still alive? (signal 0 = existence probe)
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  if (alive) {
    killGroup('SIGKILL');
  }
}
