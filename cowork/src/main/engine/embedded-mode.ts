/**
 * Helpers for deciding whether to load the embedded Code Buddy engine
 * adapter from the Electron main process bootstrap.
 *
 * Extracted from `cowork/src/main/index.ts` so the policy is unit-testable
 * without booting the full Electron environment.
 *
 * Policy (post-2026-05 invert):
 *   - Default ON: any Cowork entry point that can resolve the engine
 *     bundle (buddy gui, npm run dev, packaged app double-click, IDE
 *     launch, etc.) gets the embedded Code Buddy core agentic loop.
 *   - Opt-out: `CODEBUDDY_EMBEDDED=0` disables it explicitly. Anything
 *     else (unset, '1', '', 'true', 'yes', etc.) leaves embedded ON.
 *   - Graceful fallback: if the engine module isn't shipped (typical for
 *     packaged Cowork until electron-builder is taught to bundle it),
 *     `MODULE_NOT_FOUND` is the expected signal and is logged at info
 *     level rather than as a warning.
 *
 * @module cowork/main/engine/embedded-mode
 */

/**
 * Whether the user has opted out of embedded mode via env var.
 *
 * Only `'0'` opts out — every other value (including the historical
 * `'1'`, an empty string, or undefined) keeps the default-on behaviour.
 * This preserves backward compatibility with the launcher (which still
 * sets `CODEBUDDY_EMBEDDED=1`) while flipping the default for everyone
 * else.
 */
export function isEmbeddedOptOut(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODEBUDDY_EMBEDDED === '0';
}

/**
 * Return-shape from `classifyEngineLoadError`. Lets the caller decide
 * the log level without re-implementing the error classification.
 */
export type EngineLoadErrorClass = 'missing' | 'broken';

/**
 * Distinguish "engine not shipped at this path" (expected, log at info)
 * from "engine present but failed to load" (real bug, log at warn).
 *
 * Node's dynamic `import()` throws errors with `code === 'MODULE_NOT_FOUND'`
 * (CJS resolver) or `code === 'ERR_MODULE_NOT_FOUND'` (ESM resolver) when
 * the resolved file does not exist. Anything else means the file was
 * found but blew up while loading — that's a bug worth surfacing.
 */
export function classifyEngineLoadError(err: unknown): EngineLoadErrorClass {
  if (!err || typeof err !== 'object') return 'broken';
  const code = (err as { code?: unknown }).code;
  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
    return 'missing';
  }
  return 'broken';
}
