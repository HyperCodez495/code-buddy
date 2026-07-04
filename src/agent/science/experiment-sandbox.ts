/**
 * AI-Scientist-lite — Phase 2 experiment execution sandbox ROUTER.
 *
 * Phase 0 executes generated experiment code through the local `isolate` runner
 * (`execute-code-runner.ts`): it scrubs secrets, redirects HOME, uses a throwaway
 * cwd and a timeout — but it leaves the NETWORK WIDE OPEN. That is the security
 * hole Phase 2 closes: this router lets the experiment step run inside a
 * network-isolating containerised backend instead.
 *
 * The router is a THIN, PURE selector over three backends, exposed as an
 * `executeCode`-shaped function so it drops straight into
 * {@link ExperimentDeps.executeCode} without changing the orchestrator:
 *
 *   - `isolate` — the Phase 0/1 default. Byte-identical: the router delegates
 *     VERBATIM to the isolate runner. NETWORK NOT ISOLATED.
 *   - `docker`  — `docker run --network none` via `DockerSandbox` (the network is
 *     provably cut — the adapter asserts `networkEnabled:false`).
 *   - `e2b`     — an off-host Firecracker microVM via `E2BSandbox`. The HOST
 *     (filesystem/secrets) is unreachable, but through the existing wrapper API
 *     the microVM keeps OUTBOUND network. Honest: e2b protects the host, it does
 *     NOT cut the network.
 *
 * Safety rules (the whole point):
 *   1. NEVER degrade silently to a weaker sandbox. If the requested backend is
 *      unavailable we either (a) DEGRADE to `isolate` with a LOUD warning that
 *      the network is not isolated, or (b) FAIL CLOSED (refuse, exec not
 *      launched) when the caller passed `requireNetworkIsolation`.
 *   2. A backend that cannot provably cut the network (`isolate`, `e2b`) can
 *      never satisfy `requireNetworkIsolation` — the router refuses immediately.
 *   3. never-CRASH: a backend LAUNCHER that throws degrades cleanly (loud) unless
 *      `requireNetworkIsolation` is set, in which case it refuses rather than fall
 *      back to a network-open runner.
 *
 * Every side-effecting edge — the backend launchers, the availability detectors,
 * the warning sink — is an INJECTABLE boundary resolved lazily to the real bricks
 * and faked in tests (no real Docker/E2B in CI).
 *
 * @module agent/science/experiment-sandbox
 */

import { logger } from '../../utils/logger.js';
import type {
  ExecuteCodeInput,
  ExecuteCodeResult,
  ExecuteCodeRunnerOptions,
} from '../../tools/execute-code-runner.js';

/** The execution backends the router can select. */
export type ExperimentSandboxBackend = 'isolate' | 'docker' | 'e2b';

/**
 * The execute-code boundary shape — identical to {@link ExperimentDeps.executeCode},
 * so a router instance plugs straight in.
 */
export type ExperimentSandboxRunner = (
  input: ExecuteCodeInput,
  options: ExecuteCodeRunnerOptions,
) => Promise<ExecuteCodeResult>;

/**
 * Whether a backend PROVABLY cuts outbound network egress for the untrusted
 * experiment code.
 *
 *  - `isolate` → false. Env-scrubbed local spawn, but the network is WIDE OPEN
 *    (the exact hole Phase 2 closes).
 *  - `docker`  → true. `docker run --network none` (asserted by the adapter).
 *  - `e2b`     → false. The microVM runs OFF-HOST (host filesystem/secrets are
 *    unreachable), but through the existing wrapper API it keeps outbound
 *    network. Honest: e2b protects the HOST, not the network.
 */
export const CUTS_NETWORK: Readonly<Record<ExperimentSandboxBackend, boolean>> = {
  isolate: false,
  docker: true,
  e2b: false,
};

export interface ExperimentSandboxConfig {
  /** The requested backend. */
  backend: ExperimentSandboxBackend;
  /**
   * Fail closed (refuse to run — exec not launched) rather than degrade to a
   * network-open backend. Only a backend with `CUTS_NETWORK === true` can
   * satisfy this; anything else is refused up front.
   */
  requireNetworkIsolation?: boolean;
  /** Injectable backend launchers (default: real bricks, lazily imported). */
  runners?: Partial<Record<ExperimentSandboxBackend, ExperimentSandboxRunner>>;
  /** Injectable availability detectors (default: real DockerSandbox/E2BSandbox). */
  detect?: Partial<Record<'docker' | 'e2b', () => Promise<boolean>>>;
  /** Loud sink for degradation / disclosure warnings (default: `logger.warn`). */
  warn?: (message: string) => void;
}

/**
 * Thrown when the router refuses to run under `requireNetworkIsolation`. The
 * orchestrator catches an `executeCode` throw and turns it into a clean terminal
 * `failed` status — the pass ends honestly (no misleading report), the process
 * never crashes, and no experiment code is ever run in a weaker sandbox.
 */
export class ExperimentSandboxRefusal extends Error {
  readonly code = 'SANDBOX_NETWORK_ISOLATION_REFUSED';
  constructor(message: string) {
    super(message);
    this.name = 'ExperimentSandboxRefusal';
  }
}

// ============================================================================
// Lazy real-brick defaults (only loaded when the backend is actually selected)
// ============================================================================

async function defaultIsolateRunner(
  input: ExecuteCodeInput,
  options: ExecuteCodeRunnerOptions,
): Promise<ExecuteCodeResult> {
  const { executeCode } = await import('../../tools/execute-code-runner.js');
  return executeCode(input, options);
}

async function defaultDockerRunner(
  input: ExecuteCodeInput,
  options: ExecuteCodeRunnerOptions,
): Promise<ExecuteCodeResult> {
  const { runInDocker } = await import('./experiment-sandbox-backends.js');
  return runInDocker(input, options);
}

async function defaultE2bRunner(
  input: ExecuteCodeInput,
  options: ExecuteCodeRunnerOptions,
): Promise<ExecuteCodeResult> {
  const { runInE2b } = await import('./experiment-sandbox-backends.js');
  return runInE2b(input, options);
}

async function defaultDetectDocker(): Promise<boolean> {
  const { DockerSandbox } = await import('../../sandbox/docker-sandbox.js');
  return DockerSandbox.isAvailable();
}

async function defaultDetectE2b(): Promise<boolean> {
  const { E2BSandbox } = await import('../../sandbox/e2b-sandbox.js');
  return E2BSandbox.isAvailable();
}

// ============================================================================
// The router
// ============================================================================

/**
 * Build an `executeCode`-shaped runner that routes to the selected sandbox
 * backend. See the module docstring for the full safety contract.
 */
export function createExperimentSandboxRunner(
  config: ExperimentSandboxConfig,
): ExperimentSandboxRunner {
  const { backend } = config;
  const requireNet = config.requireNetworkIsolation === true;
  const warn = config.warn ?? ((message: string) => logger.warn(message));

  const runners = config.runners ?? {};
  const detect = config.detect ?? {};
  const runIsolate = runners.isolate ?? defaultIsolateRunner;
  const runDocker = runners.docker ?? defaultDockerRunner;
  const runE2b = runners.e2b ?? defaultE2bRunner;
  const detectDocker = detect.docker ?? defaultDetectDocker;
  const detectE2b = detect.e2b ?? defaultDetectE2b;

  return async (input, options) => {
    // ── isolate (Phase 0/1 default) ────────────────────────────────────────
    if (backend === 'isolate') {
      if (requireNet) {
        throw new ExperimentSandboxRefusal(
          "--require-network-isolation: backend 'isolate' does NOT cut network egress " +
            '(env-scrubbed local spawn keeps FULL network access). Use --sandbox docker for a ' +
            'provable network cut. Refusing to run (exec not launched).',
        );
      }
      // Byte-identical Phase 0/1: verbatim delegation to the isolate runner.
      return runIsolate(input, options);
    }

    const cutsNet = CUTS_NETWORK[backend];

    // ── A network-isolation requirement can only be met by a network-cutting
    //    backend. e2b is off-host but keeps outbound network → refuse up front.
    if (requireNet && !cutsNet) {
      throw new ExperimentSandboxRefusal(
        `--require-network-isolation: backend '${backend}' does NOT provably cut outbound network ` +
          '(it isolates the host, not the network). Use --sandbox docker. Refusing (exec not launched).',
      );
    }

    // ── Availability detection (never throws) ──────────────────────────────
    let available = false;
    try {
      available = backend === 'docker' ? await detectDocker() : await detectE2b();
    } catch {
      available = false;
    }

    if (!available) {
      if (requireNet) {
        // cutsNet is true here (docker) — do NOT fall back to network-open isolate.
        throw new ExperimentSandboxRefusal(
          `--require-network-isolation: sandbox '${backend}' is unavailable and the only fallback ` +
            "('isolate') leaves the network OPEN. Refusing to run (exec not launched). Install/start " +
            'Docker, or drop --require-network-isolation to degrade explicitly.',
        );
      }
      // Loud, explicit degradation — NEVER silent.
      warn(
        `[science] sandbox '${backend}' unavailable — DEGRADING to 'isolate'. WARNING: the network is ` +
          'NOT isolated; generated experiment code runs with FULL network access. Pass ' +
          '--require-network-isolation to refuse instead of degrading.',
      );
      return runIsolate(input, options);
    }

    // ── Available → run in the requested backend ───────────────────────────
    try {
      const result = backend === 'docker' ? await runDocker(input, options) : await runE2b(input, options);
      if (backend === 'e2b') {
        // Honest disclosure: e2b is off-host but not network-cut.
        warn(
          "[science] sandbox 'e2b': experiment ran OFF-HOST (host filesystem/secrets unreachable), but " +
            'the microVM keeps OUTBOUND network. For a provable network cut use --sandbox docker.',
        );
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (requireNet) {
        throw new ExperimentSandboxRefusal(
          `--require-network-isolation: sandbox '${backend}' launcher failed (${message}); refusing to ` +
            'fall back to the network-open isolate runner (exec not launched in a weaker sandbox).',
        );
      }
      // never-CRASH: a launcher failure degrades cleanly (loud).
      warn(
        `[science] sandbox '${backend}' launcher failed (${message}) — DEGRADING to 'isolate'. ` +
          'WARNING: the network is NOT isolated for this run.',
      );
      return runIsolate(input, options);
    }
  };
}

/**
 * Thin object face over {@link createExperimentSandboxRunner} matching the
 * `ExperimentSandbox.run(input, options) → ExecutionResult` abstraction. Holds
 * the resolved backend + its network posture for callers that want to log it.
 */
export class ExperimentSandbox {
  readonly backend: ExperimentSandboxBackend;
  readonly cutsNetwork: boolean;
  private readonly runner: ExperimentSandboxRunner;

  constructor(config: ExperimentSandboxConfig) {
    this.backend = config.backend;
    this.cutsNetwork = CUTS_NETWORK[config.backend];
    this.runner = createExperimentSandboxRunner(config);
  }

  /** Execute the experiment in the selected sandbox. */
  run(input: ExecuteCodeInput, options: ExecuteCodeRunnerOptions): Promise<ExecuteCodeResult> {
    return this.runner(input, options);
  }

  /** The `executeCode`-shaped boundary for {@link ExperimentDeps.executeCode}. */
  asExecuteCode(): ExperimentSandboxRunner {
    return this.runner;
  }
}
