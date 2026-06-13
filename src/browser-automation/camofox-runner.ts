/**
 * Camofox / Camoufox Runner
 *
 * Launches Camoufox (an anti-detect Firefox) as a subprocess and waits
 * for a Chrome-style DevTools Protocol endpoint.  The runner spawns the
 * binary with a `--cdp-port` flag and polls `http://127.0.0.1:<port>/json/version`,
 * then returns the resulting WebSocket URL.
 *
 * NOTE: this CDP contract is unverified against upstream Camoufox, which is
 * Firefox-based and does not expose a Chrome DevTools `/json/version` endpoint
 * (its `--start-debugger-server`/`--remote-debugging-port` speak Firefox RDP/BiDi,
 * not CDP). The upstream-supported automation path is `python -m camoufox server`,
 * whose Playwright-server WebSocket is driven via `playwright.firefox.connect()`
 * — note `connectOverCDP()` is Chromium-only and does not exist for Firefox.
 *
 * Falls back gracefully when the binary is not installed — every public
 * function returns a typed result rather than throwing.
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
  /** CDP port to bind (default: 9230). */
  cdpPort?: number;
  /** Milliseconds to wait for the CDP endpoint to become reachable (default: 15 000). */
  timeout?: number;
  /** Override the binary name/path (auto-detected when omitted). */
  binary?: string;
}

export interface CamofoxRunnerResult {
  ok: boolean;
  /** CDP WebSocket endpoint, e.g. `ws://127.0.0.1:9230`. */
  wsEndpoint?: string;
  error?: string;
  /** PID of the launched subprocess. */
  pid?: number;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const DEFAULT_CDP_PORT = 9230;
const DEFAULT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 250;

/**
 * Resolve the first available binary name.  Prefers `camofox` over
 * `camoufox` so the calling code stays consistent with
 * `hermes-browser-backends.ts` probe order.
 */
function resolveBinary(override?: string): string | null {
  if (override) return override;

  // We deliberately do *not* shell out to `which` here — the spawn
  // call itself will fail fast if the binary isn't on $PATH, and we
  // handle that in `launchCamofox()`.
  return null;
}

/**
 * Attempt to detect which binary name is available by spawning with
 * `--version`.  Returns the first one that succeeds.
 */
async function detectBinary(): Promise<string | null> {
  for (const candidate of ['camofox', 'camoufox']) {
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const proc = spawn(candidate, ['--version'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        proc.on('error', () => resolve(false));
        proc.on('close', (code) => resolve(code === 0));
      });
      if (ok) return candidate;
    } catch {
      // noop — try next candidate
    }
  }
  return null;
}

/**
 * Poll `http://127.0.0.1:<port>/json/version` until it responds or the
 * timeout elapses.
 */
async function waitForCdpReady(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_000);
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Launch a Camofox/Camoufox subprocess and wait for its CDP endpoint.
 *
 * ```ts
 * const result = await launchCamofox({ headless: true });
 * if (result.ok) {
 *   // The returned endpoint is a Chrome DevTools Protocol WebSocket URL.
 *   // `connectOverCDP` is Chromium-only; it is NOT valid for Firefox-based
 *   // Camoufox (see file header — upstream Camoufox uses `firefox.connect()`
 *   // against a `python -m camoufox server` endpoint instead).
 *   const browser = await playwright.chromium.connectOverCDP(result.wsEndpoint!);
 * }
 * ```
 */
export async function launchCamofox(options: CamofoxRunnerOptions = {}): Promise<CamofoxRunnerResult> {
  const cdpPort = options.cdpPort ?? DEFAULT_CDP_PORT;
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const headless = options.headless ?? true;

  // Resolve binary --------------------------------------------------------
  const binary = resolveBinary(options.binary) ?? await detectBinary();
  if (!binary) {
    return {
      ok: false,
      error: 'Camofox/Camoufox binary not found on $PATH. Install it first or set options.binary.',
    };
  }

  // Build args ------------------------------------------------------------
  const args: string[] = ['--cdp-port', String(cdpPort)];
  if (headless) args.push('--headless');

  // Spawn -----------------------------------------------------------------
  let proc: ChildProcess;
  try {
    proc = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[camofox-runner] Failed to spawn ${binary}: ${message}`);
    return { ok: false, error: `Failed to spawn ${binary}: ${message}` };
  }

  // Capture early exit / spawn error ------------------------------------
  const earlyExit = new Promise<string>((resolve) => {
    proc.on('error', (err) => resolve(`Spawn error: ${err.message}`));
    proc.on('close', (code) => {
      if (code !== null && code !== 0) {
        resolve(`Process exited with code ${code}`);
      }
    });
  });

  // Wait for CDP ----------------------------------------------------------
  const ready = await Promise.race([
    waitForCdpReady(cdpPort, timeoutMs).then((ok) => (ok ? null : 'timeout')),
    earlyExit,
  ]);

  if (ready !== null) {
    // Something went wrong — kill the orphan and report.
    try { proc.kill(); } catch { /* best-effort */ }
    const reason = ready === 'timeout'
      ? `CDP endpoint did not become reachable within ${timeoutMs}ms on port ${cdpPort}.`
      : ready;
    logger.warn(`[camofox-runner] ${reason}`);
    return { ok: false, error: reason, pid: proc.pid };
  }

  const wsEndpoint = `ws://127.0.0.1:${cdpPort}`;
  logger.debug(`[camofox-runner] CDP ready at ${wsEndpoint} (pid ${proc.pid})`);

  return {
    ok: true,
    wsEndpoint,
    pid: proc.pid,
  };
}

/**
 * Gracefully terminate a previously launched Camofox subprocess.
 */
export async function closeCamofox(pid: number): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM');
    // Give the process a moment to exit before escalating.
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    try { process.kill(pid, 0); } catch { return; } // already gone
    process.kill(pid, 'SIGKILL');
  } catch {
    // Process already exited — nothing to do.
  }
}
