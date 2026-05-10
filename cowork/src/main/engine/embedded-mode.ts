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
 *   - Graceful fallback: if the engine module isn't shipped (e.g. user
 *     ran cowork without building the parent first), `MODULE_NOT_FOUND`
 *     is the expected signal and is logged at info level rather than as
 *     a warning.
 *
 * @module cowork/main/engine/embedded-mode
 */

import * as path from 'path';

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
 * User-level engine mode persisted in Cowork's config store
 * (Settings → Advanced → "Code Buddy core engine"). Three states:
 *
 * - `'auto'` (default) — fall back to the env-var policy
 *   (`isEmbeddedOptOut`). The engine is on unless `CODEBUDDY_EMBEDDED=0`.
 * - `'force-on'` — always boot the engine. Env var is ignored.
 * - `'force-off'` — always use pi. Env var is ignored.
 *
 * The env var takes precedence in `'auto'` only — that way developers
 * setting `CODEBUDDY_EMBEDDED=0` for debug don't lose it just because
 * a user toggled the Settings to `'force-on'`.
 */
export type CoreEngineMode = 'auto' | 'force-on' | 'force-off';

/**
 * Resolve the final on/off decision given the user's Settings choice
 * + the env override + the historical default-on policy.
 *
 * Returns `true` if Cowork should attempt to load the embedded engine,
 * `false` if it should skip straight to the pi fallback.
 */
export function shouldLoadEngine(
  userMode: CoreEngineMode | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (userMode === 'force-on') return true;
  if (userMode === 'force-off') return false;
  // 'auto' (or undefined / unknown) → defer to env policy.
  return !isEmbeddedOptOut(env);
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

/**
 * Inputs for `resolveEnginePath`. Pure data — the function takes
 * Electron-derived values as plain arguments so it can be tested
 * without booting Electron.
 */
export interface ResolveEnginePathInput {
  /** Value of `process.env.CODEBUDDY_ENGINE_PATH` (override). */
  envOverride?: string;
  /** Value of `app.isPackaged`. */
  isPackaged: boolean;
  /** Value of `process.resourcesPath` (only meaningful when packaged). */
  resourcesPath: string;
  /** Value of `app.getAppPath()`. */
  appPath: string;
  /**
   * Directory of the main bundle, derived by the caller from
   * `path.dirname(fileURLToPath(import.meta.url))`. When supplied AND
   * we're in dev mode (not packaged + no env override), this is
   * preferred over `appPath` because it's stable regardless of how
   * Electron was invoked — direct binary launch with a file path
   * argument, for example, sets `appPath` to the dir of that file
   * instead of the cowork/ source tree.
   *
   * Layout assumption: the main bundle lives at
   * `<repo>/cowork/dist-electron/main/index.js`, so the engine sits
   * at `<bundleDir>/../../../dist/`. Optional; if omitted (e.g. unit
   * tests without a bundle), the resolver falls back to the
   * `appPath`-based 'dev' layer.
   */
  mainBundleDir?: string;
}

/**
 * Resolve the directory under which the Code Buddy core engine ships
 * (i.e. the directory containing `desktop/codebuddy-engine-adapter.js`).
 *
 * Three layers, narrow → broad:
 *   1. `CODEBUDDY_ENGINE_PATH` env override — used verbatim when set
 *      to a non-empty string. Empty strings are treated as unset to
 *      avoid silently disabling auto-resolution.
 *   2. **Packaged mode** (`app.isPackaged === true`): the engine ships
 *      via `extraResources` at `<install>/resources/dist/`. Resolved
 *      via `process.resourcesPath`.
 *   3. **Dev / unpackaged**: the engine ships next to `cowork/` at
 *      `<repo>/dist/`. Resolved via `app.getAppPath()` + `..`. This is
 *      the path used by `npm run dev` and by the `buddy gui` launcher.
 *
 * Pure function. No imports of `electron`. Caller passes whatever
 * Electron's runtime exposes.
 */
export function resolveEnginePath(args: ResolveEnginePathInput): string {
  return resolveEnginePathWithDiagnostic(args).path;
}

/** Which `resolveEnginePath` layer produced the result. Useful in logs
 *  so a missing engine file is debuggable from a single startup line.
 *  `'dev-from-bundle'` is a more reliable variant of `'dev'` that uses
 *  `import.meta.url` of the main bundle instead of `app.getAppPath()`. */
export type EnginePathLayer = 'env-override' | 'packaged' | 'dev-from-bundle' | 'dev';

/**
 * Resolution + the layer that produced it. Same logic as
 * {@link resolveEnginePath} but returns enough context for the caller
 * to print "Engine resolved to <path> via <layer>" — when the file
 * isn't where the resolver pointed, that single line tells you which
 * fallback to try (`CODEBUDDY_ENGINE_PATH`, rebuild, ...).
 */
export interface EnginePathResolution {
  path: string;
  layer: EnginePathLayer;
}

export function resolveEnginePathWithDiagnostic(
  args: ResolveEnginePathInput,
): EnginePathResolution {
  if (args.envOverride !== undefined && args.envOverride !== '') {
    return { path: args.envOverride, layer: 'env-override' };
  }
  if (args.isPackaged) {
    return { path: path.join(args.resourcesPath, 'dist'), layer: 'packaged' };
  }
  // Prefer `import.meta.url` of the main bundle when available — it's
  // stable regardless of how Electron was invoked. Direct binary
  // launches (e.g. `electron ./dist-electron/main/index.js`) set
  // `app.getAppPath()` to the dir of the file argument, which makes
  // the appPath-based layer compute the wrong path.
  if (args.mainBundleDir !== undefined && args.mainBundleDir !== '') {
    return {
      path: path.resolve(args.mainBundleDir, '..', '..', '..', 'dist'),
      layer: 'dev-from-bundle',
    };
  }
  return { path: path.resolve(args.appPath, '..', 'dist'), layer: 'dev' };
}
