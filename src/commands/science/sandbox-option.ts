/**
 * `buddy science` — Phase 2 sandbox option resolution (pure, testable).
 *
 * Resolves the execution sandbox backend from the CLI `--sandbox` flag, the
 * `CODEBUDDY_SCIENCE_SANDBOX` env var, and `--require-network-isolation`.
 *
 * Contract (the load-bearing part for byte-identical Phase 0/1):
 *   - NO opt-in at all (no `--sandbox`, no env, no require flag) ⇒ `{ kind: 'none' }`.
 *     The caller then wires the plain isolate runner — Phase 0/1 is untouched.
 *   - `--require-network-isolation` WITHOUT an explicit backend defaults to
 *     `docker` (the network-cutting backend) so the requirement can be met.
 *   - An unknown backend ⇒ `{ kind: 'invalid' }` (the caller aborts, exit 1).
 *
 * @module commands/science/sandbox-option
 */

import type { ExperimentSandboxBackend } from '../../agent/science/experiment-sandbox.js';

const VALID_BACKENDS: readonly ExperimentSandboxBackend[] = ['isolate', 'docker', 'e2b'];

/** The outcome of resolving the sandbox selection from CLI + env. */
export type ScienceSandboxResolution =
  /** No Phase 2 opt-in ⇒ byte-identical Phase 0/1 (plain isolate runner). */
  | { kind: 'none' }
  /** A bad backend name ⇒ the caller prints `error` and aborts. */
  | { kind: 'invalid'; error: string }
  /** An explicit sandbox selection to route through the Phase 2 router. */
  | { kind: 'sandbox'; backend: ExperimentSandboxBackend; requireNetworkIsolation: boolean };

export interface ScienceSandboxInput {
  /** The `--sandbox <backend>` flag value, if supplied. */
  sandbox?: string | undefined;
  /** The `--require-network-isolation` flag. */
  requireNetworkIsolation?: boolean | undefined;
}

/**
 * Resolve the sandbox selection. Pure: reads only its arguments (env is passed
 * in explicitly so tests need not mutate `process.env`).
 */
export function resolveScienceSandbox(
  opts: ScienceSandboxInput,
  env: Record<string, string | undefined> = {},
): ScienceSandboxResolution {
  const requireNetworkIsolation = opts.requireNetworkIsolation === true;
  const explicit = (opts.sandbox ?? env.CODEBUDDY_SCIENCE_SANDBOX ?? '').trim().toLowerCase();

  // No opt-in whatsoever ⇒ byte-identical Phase 0/1.
  if (!explicit && !requireNetworkIsolation) {
    return { kind: 'none' };
  }

  // `--require-network-isolation` alone implies the network-cutting backend.
  const backend = explicit || 'docker';
  if (!VALID_BACKENDS.includes(backend as ExperimentSandboxBackend)) {
    return {
      kind: 'invalid',
      error: `Invalid --sandbox "${backend}". Use one of: ${VALID_BACKENDS.join(', ')}.`,
    };
  }

  return {
    kind: 'sandbox',
    backend: backend as ExperimentSandboxBackend,
    requireNetworkIsolation,
  };
}
