/**
 * AI-Scientist-lite Phase 2 — sandbox ROUTER unit tests.
 *
 * The router is exercised with INJECTED backend launchers, availability
 * detectors and a warning sink, so there is ZERO real Docker/E2B in CI. The
 * load-bearing properties:
 *   - `--sandbox docker` (available) routes to the docker launcher.
 *   - default `isolate` delegates VERBATIM (byte-identical Phase 0/1).
 *   - an unavailable backend NEVER degrades silently — it either DEGRADES with a
 *     loud warning or FAILS CLOSED under requireNetworkIsolation (exec NOT
 *     launched).
 *   - a launcher that throws degrades cleanly (never crashes).
 */
import { describe, it, expect, vi } from 'vitest';

import {
  createExperimentSandboxRunner,
  ExperimentSandbox,
  ExperimentSandboxRefusal,
  CUTS_NETWORK,
  type ExperimentSandboxRunner,
} from '../../../src/agent/science/experiment-sandbox.js';
import type {
  ExecuteCodeInput,
  ExecuteCodeResult,
  ExecuteCodeRunnerOptions,
} from '../../../src/tools/execute-code-runner.js';

// --------------------------------------------------------------------------
// Fakes
// --------------------------------------------------------------------------

const INPUT: ExecuteCodeInput = { code: 'print("accuracy=0.9")', language: 'python', timeoutMs: 5000 };
const OPTIONS: ExecuteCodeRunnerOptions = { envMode: 'isolate', rootDir: '/work/root' };

function sentinel(tag: string): ExecuteCodeResult {
  return {
    kind: 'execute_code_result',
    ok: true,
    runId: tag,
    language: 'python',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 10,
    commandPreview: `[${tag}]`,
    runDir: `/tmp/${tag}`,
    scriptPath: `/tmp/${tag}/script.py`,
    stdoutPath: `/tmp/${tag}/stdout.log`,
    stderrPath: `/tmp/${tag}/stderr.log`,
    resultPath: `/tmp/${tag}/result.json`,
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: 'accuracy=0.9\n',
    stderr: '',
    files: ['result.json'],
  };
}

interface Harness {
  runner: ExperimentSandboxRunner;
  isolate: ReturnType<typeof vi.fn>;
  docker: ReturnType<typeof vi.fn>;
  e2b: ReturnType<typeof vi.fn>;
  detectDocker: ReturnType<typeof vi.fn>;
  detectE2b: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
}

function makeRouter(
  backend: 'isolate' | 'docker' | 'e2b',
  over: {
    requireNetworkIsolation?: boolean;
    dockerAvailable?: boolean;
    e2bAvailable?: boolean;
    isolate?: ExperimentSandboxRunner;
    docker?: ExperimentSandboxRunner;
    e2b?: ExperimentSandboxRunner;
    detectDocker?: () => Promise<boolean>;
    detectE2b?: () => Promise<boolean>;
  } = {},
): Harness {
  const isolate = vi.fn(over.isolate ?? (async () => sentinel('isolate')));
  const docker = vi.fn(over.docker ?? (async () => sentinel('docker')));
  const e2b = vi.fn(over.e2b ?? (async () => sentinel('e2b')));
  const detectDocker = vi.fn(over.detectDocker ?? (async () => over.dockerAvailable ?? true));
  const detectE2b = vi.fn(over.detectE2b ?? (async () => over.e2bAvailable ?? true));
  const warn = vi.fn();
  const runner = createExperimentSandboxRunner({
    backend,
    ...(over.requireNetworkIsolation ? { requireNetworkIsolation: true } : {}),
    runners: { isolate, docker, e2b },
    detect: { docker: detectDocker, e2b: detectE2b },
    warn,
  });
  return { runner, isolate, docker, e2b, detectDocker, detectE2b, warn };
}

// --------------------------------------------------------------------------
// Routing
// --------------------------------------------------------------------------

describe('experiment-sandbox router — routing', () => {
  it('default isolate delegates VERBATIM (byte-identical Phase 0/1)', async () => {
    const only = sentinel('isolate-verbatim');
    const h = makeRouter('isolate', { isolate: async () => only });
    const out = await h.runner(INPUT, OPTIONS);

    // The exact object is returned untouched — no wrapping / no mutation.
    expect(out).toBe(only);
    expect(h.isolate).toHaveBeenCalledOnce();
    expect(h.isolate.mock.calls[0]).toEqual([INPUT, OPTIONS]);
    expect(h.docker).not.toHaveBeenCalled();
    expect(h.e2b).not.toHaveBeenCalled();
    expect(h.warn).not.toHaveBeenCalled(); // no warning on the default path
  });

  it('--sandbox docker (available) routes to the docker launcher, not isolate', async () => {
    const h = makeRouter('docker', { dockerAvailable: true });
    const out = await h.runner(INPUT, OPTIONS);

    expect(h.docker).toHaveBeenCalledOnce();
    expect(h.docker.mock.calls[0]).toEqual([INPUT, OPTIONS]);
    expect(h.isolate).not.toHaveBeenCalled();
    expect(h.detectDocker).toHaveBeenCalledOnce();
    expect(out.runId).toBe('docker');
  });

  it('--sandbox e2b (available) routes to e2b and discloses that network is NOT cut', async () => {
    const h = makeRouter('e2b', { e2bAvailable: true });
    const out = await h.runner(INPUT, OPTIONS);

    expect(h.e2b).toHaveBeenCalledOnce();
    expect(h.isolate).not.toHaveBeenCalled();
    expect(out.runId).toBe('e2b');
    // Honest disclosure: off-host but outbound network stays up.
    expect(h.warn).toHaveBeenCalledOnce();
    expect(h.warn.mock.calls[0]?.[0]).toMatch(/OFF-HOST|OUTBOUND network/i);
  });
});

// --------------------------------------------------------------------------
// Honest fallback — NEVER silent
// --------------------------------------------------------------------------

describe('experiment-sandbox router — honest fallback', () => {
  it('docker unavailable + no requirement → DEGRADES to isolate with a LOUD warning', async () => {
    const h = makeRouter('docker', { dockerAvailable: false });
    const out = await h.runner(INPUT, OPTIONS);

    expect(h.docker).not.toHaveBeenCalled();
    expect(h.isolate).toHaveBeenCalledOnce();
    expect(h.isolate.mock.calls[0]).toEqual([INPUT, OPTIONS]);
    expect(out.runId).toBe('isolate');
    // The warning must be explicit that the network is NOT isolated.
    expect(h.warn).toHaveBeenCalledOnce();
    expect(h.warn.mock.calls[0]?.[0]).toMatch(/DEGRADING/);
    expect(h.warn.mock.calls[0]?.[0]).toMatch(/network is NOT isolated|FULL network/i);
  });

  it('docker unavailable + --require-network-isolation → FAILS CLOSED (exec NOT launched)', async () => {
    const h = makeRouter('docker', { dockerAvailable: false, requireNetworkIsolation: true });

    await expect(h.runner(INPUT, OPTIONS)).rejects.toBeInstanceOf(ExperimentSandboxRefusal);
    // The critical property: NOTHING ran — not docker, and NOT the weaker isolate.
    expect(h.docker).not.toHaveBeenCalled();
    expect(h.isolate).not.toHaveBeenCalled();
  });

  it('isolate + --require-network-isolation → refuses up front (isolate cannot cut network)', async () => {
    const h = makeRouter('isolate', { requireNetworkIsolation: true });

    await expect(h.runner(INPUT, OPTIONS)).rejects.toBeInstanceOf(ExperimentSandboxRefusal);
    expect(h.isolate).not.toHaveBeenCalled();
  });

  it('e2b + --require-network-isolation → refuses BEFORE detection (e2b does not cut network)', async () => {
    const h = makeRouter('e2b', { requireNetworkIsolation: true });

    await expect(h.runner(INPUT, OPTIONS)).rejects.toBeInstanceOf(ExperimentSandboxRefusal);
    expect(h.e2b).not.toHaveBeenCalled();
    expect(h.detectE2b).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// never-throws (launcher / detector failures)
// --------------------------------------------------------------------------

describe('experiment-sandbox router — never-crashes', () => {
  it('docker launcher THROWS + no requirement → degrades cleanly to isolate (loud)', async () => {
    const h = makeRouter('docker', {
      dockerAvailable: true,
      docker: async () => {
        throw new Error('docker daemon exploded');
      },
    });
    const out = await h.runner(INPUT, OPTIONS);

    expect(out.runId).toBe('isolate');
    expect(h.isolate).toHaveBeenCalledOnce();
    expect(h.warn).toHaveBeenCalledOnce();
    expect(h.warn.mock.calls[0]?.[0]).toMatch(/launcher failed/i);
  });

  it('docker launcher THROWS + --require-network-isolation → refuses (no isolate fallback)', async () => {
    const h = makeRouter('docker', {
      dockerAvailable: true,
      requireNetworkIsolation: true,
      docker: async () => {
        throw new Error('docker daemon exploded');
      },
    });

    await expect(h.runner(INPUT, OPTIONS)).rejects.toBeInstanceOf(ExperimentSandboxRefusal);
    expect(h.isolate).not.toHaveBeenCalled();
  });

  it('availability detector THROWS → treated as unavailable → degrades (no require)', async () => {
    const h = makeRouter('docker', {
      detectDocker: async () => {
        throw new Error('spawn docker ENOENT');
      },
    });
    const out = await h.runner(INPUT, OPTIONS);

    expect(out.runId).toBe('isolate');
    expect(h.isolate).toHaveBeenCalledOnce();
    expect(h.warn).toHaveBeenCalledOnce();
  });
});

// --------------------------------------------------------------------------
// Metadata + class face
// --------------------------------------------------------------------------

describe('experiment-sandbox — network posture + class', () => {
  it('CUTS_NETWORK is honest: only docker provably cuts the network', () => {
    expect(CUTS_NETWORK.isolate).toBe(false);
    expect(CUTS_NETWORK.docker).toBe(true);
    expect(CUTS_NETWORK.e2b).toBe(false);
  });

  it('ExperimentSandbox class exposes backend + cutsNetwork and delegates run()', async () => {
    const isolate = vi.fn(async () => sentinel('cls'));
    const sandbox = new ExperimentSandbox({ backend: 'isolate', runners: { isolate } });
    expect(sandbox.backend).toBe('isolate');
    expect(sandbox.cutsNetwork).toBe(false);

    const out = await sandbox.run(INPUT, OPTIONS);
    expect(out.runId).toBe('cls');
    expect(isolate).toHaveBeenCalledOnce();

    const dockerSandbox = new ExperimentSandbox({ backend: 'docker' });
    expect(dockerSandbox.cutsNetwork).toBe(true);
  });
});
