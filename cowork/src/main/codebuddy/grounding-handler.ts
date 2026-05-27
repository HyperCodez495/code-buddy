/**
 * Apply the user's "Gemini Google Search grounding" preference to a
 * live engine adapter, with graceful fallback when the adapter doesn't
 * support the toggle (e.g. pi-coding-agent path or any future adapter
 * that doesn't route through the Gemini-native provider).
 *
 * Pure function — no Electron imports, no IPC. The IPC handler in
 * `cowork/src/main/index.ts` is a thin wrapper that calls this and
 * forwards the result to the renderer. Keeps the policy testable
 * without booting Electron.
 *
 * @module cowork/main/codebuddy/grounding-handler
 */

import type { EngineAdapterLike } from '../session/session-manager';

export interface ApplyGroundingResult {
  /** True if the toggle was forwarded to the adapter; false if no-op. */
  ok: boolean;
  /** Human-readable reason when `ok` is false. Used for logs / UI hints. */
  reason?: string;
}

/**
 * Forward a grounding toggle to the engine adapter.
 *
 * Three outcomes:
 *   - Adapter is `undefined` → `{ ok: false, reason: 'no-adapter' }`.
 *     Happens when Cowork is running on the pi-coding-agent fallback
 *     (CODEBUDDY_EMBEDDED=0 or engine bundle missing). The setting is
 *     still saved to the config store and will apply on next restart
 *     into embedded mode.
 *   - Adapter present but lacks `setDefaultGoogleSearch` →
 *     `{ ok: false, reason: 'unsupported' }`. Future-proofing for any
 *     adapter that doesn't route through the Gemini-native provider.
 *   - Adapter implements the method → call it with `enabled` and
 *     return `{ ok: true }`.
 *
 * Never throws — caller doesn't need a try/catch wrapper.
 */
export function applyGroundingToggle(
  adapter: EngineAdapterLike | undefined,
  enabled: boolean,
): ApplyGroundingResult {
  if (!adapter) {
    return { ok: false, reason: 'no-adapter' };
  }
  if (typeof adapter.setDefaultGoogleSearch !== 'function') {
    return { ok: false, reason: 'unsupported' };
  }
  adapter.setDefaultGoogleSearch(enabled);
  return { ok: true };
}

/**
 * Forward a visual grounding fallback toggle and optional model override to the engine adapter.
 */
export function applyVisionGroundingSetting(
  adapter: EngineAdapterLike | undefined,
  enabled: boolean,
  model?: string,
): ApplyGroundingResult {
  if (!adapter) {
    return { ok: false, reason: 'no-adapter' };
  }
  if (typeof adapter.setDefaultVisionGrounding !== 'function') {
    return { ok: false, reason: 'unsupported' };
  }
  adapter.setDefaultVisionGrounding(enabled, model);
  return { ok: true };
}

