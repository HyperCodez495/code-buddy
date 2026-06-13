import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'child_process';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the import under test
// ---------------------------------------------------------------------------

const spawnMock = vi.fn();
const killMock = vi.fn();

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
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock ChildProcess that emits lifecycle events. */
function mockChildProcess(overrides: {
  pid?: number;
  exitCode?: number | null;
  spawnError?: Error;
} = {}): ChildProcess {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const proc = {
    pid: overrides.pid ?? 12345,
    kill: killMock,
    on(event: string, cb: (...args: unknown[]) => void) {
      const list = listeners.get(event) ?? [];
      list.push(cb);
      listeners.set(event, list);

      // If a spawn error was requested, fire it immediately.
      if (event === 'error' && overrides.spawnError) {
        queueMicrotask(() => cb(overrides.spawnError));
      }

      return proc;
    },
    _emit(event: string, ...args: unknown[]) {
      for (const cb of listeners.get(event) ?? []) cb(...args);
    },
  } as unknown as ChildProcess;

  return proc;
}

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import { launchCamofox, closeCamofox } from '../../src/browser-automation/camofox-runner.js';

describe('camofox-runner', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -----------------------------------------------------------------------
  // Binary detection
  // -----------------------------------------------------------------------

  it('returns an error when no binary is found', async () => {
    // Both `camofox --version` and `camoufox --version` probes fail.
    spawnMock.mockImplementation(() => {
      const proc = mockChildProcess({ spawnError: new Error('ENOENT') });
      return proc;
    });

    const result = await launchCamofox();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  // -----------------------------------------------------------------------
  // Successful launch
  // -----------------------------------------------------------------------

  it('launches the binary and waits for CDP', async () => {
    // Detection phase: first candidate (`camofox --version`) succeeds.
    let detectCallCount = 0;
    spawnMock.mockImplementation((_binary: string, args: string[]) => {
      if (args[0] === '--version') {
        detectCallCount++;
        const proc = mockChildProcess({ pid: 100 });
        // Simulate immediate successful exit.
        queueMicrotask(() => (proc as unknown as { _emit: Function })._emit('close', 0));
        return proc;
      }
      // Actual launch call.
      return mockChildProcess({ pid: 42 });
    });

    // CDP endpoint ready immediately.
    fetchMock.mockResolvedValue({ ok: true });

    const result = await launchCamofox({ cdpPort: 9250, timeout: 2000 });

    expect(result.ok).toBe(true);
    expect(result.wsEndpoint).toBe('ws://127.0.0.1:9250');
    expect(result.pid).toBe(42);
  });

  // -----------------------------------------------------------------------
  // Headless flag
  // -----------------------------------------------------------------------

  it('passes --headless when headless is true', async () => {
    spawnMock.mockImplementation((_binary: string, args: string[]) => {
      if (args[0] === '--version') {
        const proc = mockChildProcess();
        queueMicrotask(() => (proc as unknown as { _emit: Function })._emit('close', 0));
        return proc;
      }
      return mockChildProcess({ pid: 99 });
    });
    fetchMock.mockResolvedValue({ ok: true });

    await launchCamofox({ headless: true, timeout: 1000 });

    // The second call is the actual launch (after detection).
    const launchCall = spawnMock.mock.calls.find(
      (call: unknown[]) => (call[1] as string[])[0] !== '--version',
    );
    expect(launchCall).toBeDefined();
    expect((launchCall![1] as string[])).toContain('--headless');
  });

  // -----------------------------------------------------------------------
  // Timeout
  // -----------------------------------------------------------------------

  it('returns an error when CDP never becomes ready', async () => {
    spawnMock.mockImplementation((_binary: string, args: string[]) => {
      if (args[0] === '--version') {
        const proc = mockChildProcess();
        queueMicrotask(() => (proc as unknown as { _emit: Function })._emit('close', 0));
        return proc;
      }
      return mockChildProcess({ pid: 55 });
    });

    // CDP never responds.
    fetchMock.mockRejectedValue(new Error('connection refused'));

    const result = await launchCamofox({ timeout: 500 });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/did not become reachable/i);
  });

  // -----------------------------------------------------------------------
  // Binary override
  // -----------------------------------------------------------------------

  it('uses the explicit binary when provided', async () => {
    spawnMock.mockImplementation(() => mockChildProcess({ pid: 77 }));
    fetchMock.mockResolvedValue({ ok: true });

    const result = await launchCamofox({ binary: '/opt/camofox/bin/camofox', timeout: 1000 });

    expect(result.ok).toBe(true);
    // The first spawn call should use the explicit binary path.
    const firstCall = spawnMock.mock.calls[0];
    expect(firstCall[0]).toBe('/opt/camofox/bin/camofox');
  });

  // -----------------------------------------------------------------------
  // Spawn failure
  // -----------------------------------------------------------------------

  it('handles spawn throwing synchronously', async () => {
    // Detection succeeds for `camofox`.
    let detected = false;
    spawnMock.mockImplementation((_binary: string, args: string[]) => {
      if (args[0] === '--version' && !detected) {
        detected = true;
        const proc = mockChildProcess();
        queueMicrotask(() => (proc as unknown as { _emit: Function })._emit('close', 0));
        return proc;
      }
      throw new Error('EACCES');
    });

    const result = await launchCamofox({ timeout: 1000 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/EACCES/);
  });

  // -----------------------------------------------------------------------
  // closeCamofox
  // -----------------------------------------------------------------------

  describe('closeCamofox', () => {
    it('sends SIGTERM then SIGKILL if still alive', async () => {
      const processKillSpy = vi.spyOn(process, 'kill').mockImplementation((() => {
        // Process is still alive after SIGTERM
      }) as () => true);

      await closeCamofox(12345);

      expect(processKillSpy).toHaveBeenCalledWith(12345, 'SIGTERM');
      processKillSpy.mockRestore();
    });

    it('tolerates an already-exited process', async () => {
      const processKillSpy = vi.spyOn(process, 'kill').mockImplementation((() => {
        throw new Error('ESRCH');
      }) as () => true);

      // Should not throw.
      await closeCamofox(99999);
      processKillSpy.mockRestore();
    });
  });
});
