import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'child_process';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the import under test
// ---------------------------------------------------------------------------

const spawnMock = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers — a stream-like ChildProcess mock for the Playwright-server runner
// ---------------------------------------------------------------------------

interface MockProc {
  proc: ChildProcess;
  emitStdout: (chunk: string) => void;
  emitStderr: (chunk: string) => void;
  emitClose: (code: number | null) => void;
  emitError: (err: Error) => void;
}

/** Build a minimal mock ChildProcess with stdout/stderr emitters. */
function mockChildProcess(overrides: { pid?: number } = {}): MockProc {
  const stdoutCbs: ((chunk: Buffer) => void)[] = [];
  const stderrCbs: ((chunk: Buffer) => void)[] = [];
  const procCbs = new Map<string, ((...args: unknown[]) => void)[]>();

  const stream = (cbs: ((chunk: Buffer) => void)[]) => ({
    on(event: string, cb: (chunk: Buffer) => void) {
      if (event === 'data') cbs.push(cb);
      return this;
    },
  });

  const proc = {
    pid: overrides.pid ?? 4242,
    stdout: stream(stdoutCbs),
    stderr: stream(stderrCbs),
    unref: vi.fn(),
    kill: vi.fn(),
    on(event: string, cb: (...args: unknown[]) => void) {
      const list = procCbs.get(event) ?? [];
      list.push(cb);
      procCbs.set(event, list);
      return proc;
    },
  } as unknown as ChildProcess;

  return {
    proc,
    emitStdout: (chunk) => stdoutCbs.forEach((cb) => cb(Buffer.from(chunk))),
    emitStderr: (chunk) => stderrCbs.forEach((cb) => cb(Buffer.from(chunk))),
    emitClose: (code) => (procCbs.get('close') ?? []).forEach((cb) => cb(code)),
    emitError: (err) => (procCbs.get('error') ?? []).forEach((cb) => cb(err)),
  };
}

// The exact upstream stdout line (colour-wrapped) that prints the endpoint.
const ENDPOINT_LINE =
  'Server launched: 365.105ms\n' +
  'Websocket endpoint:\x1b[93m ws://localhost:44477/51422436867b21da7464b5b253fd2fdd \x1b[0m\n';
const EXPECTED_WS = 'ws://localhost:44477/51422436867b21da7464b5b253fd2fdd';

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import {
  launchCamofox,
  closeCamofox,
  parseWsEndpoint,
} from '../../src/browser-automation/camofox-runner.js';

describe('camofox-runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CODEBUDDY_CAMOFOX_PYTHON;
    delete process.env.CODEBUDDY_CAMOFOX_BINARY;
  });

  afterEach(() => {
    delete process.env.CODEBUDDY_CAMOFOX_PYTHON;
    delete process.env.CODEBUDDY_CAMOFOX_BINARY;
  });

  // -----------------------------------------------------------------------
  // parseWsEndpoint — endpoint extraction & truncation guard
  // -----------------------------------------------------------------------

  describe('parseWsEndpoint', () => {
    it('extracts the endpoint from the full ANSI-wrapped line', () => {
      expect(parseWsEndpoint(ENDPOINT_LINE)).toBe(EXPECTED_WS);
    });

    it('returns null for a truncated (mid-line) chunk', () => {
      // Pipe split before the trailing reset/whitespace — must NOT resolve a
      // partial URL.
      const partial = 'Websocket endpoint:\x1b[93m ws://localhost:44477/5142';
      expect(parseWsEndpoint(partial)).toBeNull();
    });

    it('resolves once the remaining chunk completes the line', () => {
      const partial = 'Websocket endpoint:\x1b[93m ws://localhost:44477/5142';
      const rest = '2436867b21da7464b5b253fd2fdd \x1b[0m\n';
      expect(parseWsEndpoint(partial + rest)).toBe(EXPECTED_WS);
    });

    it('returns null when no endpoint is present', () => {
      expect(parseWsEndpoint('Launching server...\nError launching server')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Successful launch — server prints a wsEndpoint
  // -----------------------------------------------------------------------

  it('spawns the python launcher and returns the parsed wsEndpoint', async () => {
    const mock = mockChildProcess({ pid: 100 });
    spawnMock.mockReturnValue(mock.proc);

    const promise = launchCamofox({ timeout: 2000 });
    // Emit the endpoint line after the listeners are attached.
    queueMicrotask(() => mock.emitStdout(ENDPOINT_LINE));

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.wsEndpoint).toBe(EXPECTED_WS);
    expect(result.pid).toBe(100);

    // Spawned the python interpreter with `-c <script>`, detached.
    const [cmd, args, opts] = spawnMock.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(cmd).toBe('python3');
    expect(args[0]).toBe('-c');
    expect(args[1]).toContain('launch_options');
    expect(args[1]).toContain('headless=True');
    expect(opts.detached).toBe(true);
  });

  it('handles a split-chunk endpoint without resolving a truncated URL', async () => {
    const mock = mockChildProcess({ pid: 101 });
    spawnMock.mockReturnValue(mock.proc);

    const promise = launchCamofox({ timeout: 2000 });
    queueMicrotask(() => {
      mock.emitStdout('Websocket endpoint:\x1b[93m ws://localhost:44477/5142');
      mock.emitStdout('2436867b21da7464b5b253fd2fdd \x1b[0m\n');
    });

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.wsEndpoint).toBe(EXPECTED_WS);
  });

  // -----------------------------------------------------------------------
  // headless flag
  // -----------------------------------------------------------------------

  it('passes headless=False when headless is false', async () => {
    const mock = mockChildProcess();
    spawnMock.mockReturnValue(mock.proc);

    const promise = launchCamofox({ headless: false, timeout: 1000 });
    queueMicrotask(() => mock.emitStdout(ENDPOINT_LINE));
    await promise;

    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args[1]).toContain('headless=False');
  });

  // -----------------------------------------------------------------------
  // binaryPath / pythonPath options
  // -----------------------------------------------------------------------

  it('uses the explicit pythonPath and embeds the binaryPath', async () => {
    const mock = mockChildProcess();
    spawnMock.mockReturnValue(mock.proc);

    const promise = launchCamofox({
      pythonPath: '/tmp/venv/bin/python',
      binaryPath: '/opt/camofox/camofox',
      timeout: 1000,
    });
    queueMicrotask(() => mock.emitStdout(ENDPOINT_LINE));
    await promise;

    const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('/tmp/venv/bin/python');
    expect(args[1]).toContain('executable_path=');
    expect(args[1]).toContain('/opt/camofox/camofox');
  });

  // -----------------------------------------------------------------------
  // Spawn / import errors
  // -----------------------------------------------------------------------

  it('returns an error when spawn throws synchronously', async () => {
    spawnMock.mockImplementation(() => {
      throw new Error('EACCES');
    });

    const result = await launchCamofox({ timeout: 1000 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/EACCES/);
  });

  it('reports a missing interpreter / camoufox package on ENOENT', async () => {
    const mock = mockChildProcess();
    spawnMock.mockReturnValue(mock.proc);

    const promise = launchCamofox({ timeout: 1000 });
    queueMicrotask(() => mock.emitError(new Error('spawn python3 ENOENT')));

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ENOENT/);
    expect(result.error).toMatch(/camoufox/i);
  });

  it('surfaces a ModuleNotFoundError when camoufox is not installed', async () => {
    const mock = mockChildProcess({ pid: 7 });
    spawnMock.mockReturnValue(mock.proc);

    const promise = launchCamofox({ timeout: 1000 });
    queueMicrotask(() => {
      mock.emitStderr("ModuleNotFoundError: No module named 'camoufox'\n");
      mock.emitClose(1);
    });

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/camoufox/i);
    expect(result.error).toMatch(/exited/i);
  });

  it('surfaces a Playwright version-guard mismatch honestly', async () => {
    const mock = mockChildProcess({ pid: 8 });
    spawnMock.mockReturnValue(mock.proc);

    const promise = launchCamofox({ timeout: 1000 });
    queueMicrotask(() => {
      mock.emitStderr(
        'Error: server is using Playwright 1.49.1 which is incompatible with this client\n',
      );
      mock.emitClose(1);
    });

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/version/i);
    expect(result.error).toMatch(/Playwright 1\.58/);
  });

  // -----------------------------------------------------------------------
  // Timeout
  // -----------------------------------------------------------------------

  it('times out and kills the process group when no endpoint is printed', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as () => true);
    const mock = mockChildProcess({ pid: 555 });
    spawnMock.mockReturnValue(mock.proc);

    const result = await launchCamofox({ timeout: 50 });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/did not print a wsEndpoint/i);
    // Killed the whole group (negative pid).
    expect(killSpy).toHaveBeenCalledWith(-555, 'SIGKILL');
    killSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // closeCamofox — process-group reaping
  // -----------------------------------------------------------------------

  describe('closeCamofox', () => {
    it('signals the whole process group, escalating SIGTERM → SIGKILL', async () => {
      const calls: Array<[number, string | number]> = [];
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal: string | number) => {
        calls.push([pid, signal]);
        return true; // always "alive"
      }) as typeof process.kill);

      await closeCamofox(12345);

      // Group SIGTERM, then existence probe, then group SIGKILL.
      expect(calls).toContainEqual([-12345, 'SIGTERM']);
      expect(calls).toContainEqual([12345, 0]);
      expect(calls).toContainEqual([-12345, 'SIGKILL']);
      killSpy.mockRestore();
    });

    it('falls back to the single pid when the group kill fails', async () => {
      const calls: Array<[number, string | number]> = [];
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal: string | number) => {
        calls.push([pid, signal]);
        if (pid < 0) throw new Error('ESRCH'); // no such group
        if (signal === 0) throw new Error('ESRCH'); // probe: already gone
        return true;
      }) as typeof process.kill);

      await closeCamofox(999);

      // Group SIGTERM failed → fell back to single-pid SIGTERM.
      expect(calls).toContainEqual([-999, 'SIGTERM']);
      expect(calls).toContainEqual([999, 'SIGTERM']);
      killSpy.mockRestore();
    });

    it('tolerates an already-exited process', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => {
        throw new Error('ESRCH');
      }) as () => true);

      await expect(closeCamofox(99999)).resolves.toBeUndefined();
      killSpy.mockRestore();
    });
  });
});
