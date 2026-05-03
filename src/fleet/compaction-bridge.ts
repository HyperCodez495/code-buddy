/**
 * Fleet compaction bridge (Phase (d).10 V0.4.1).
 *
 * Listens on the SmartCompactionEngine singleton's internal lifecycle
 * events (`compaction:start`, `compaction:complete`) and re-emits them
 * to fleet:listen consumers via the fleet-bridge broadcast surface.
 *
 * Why a separate module rather than inlining in smart-compaction.ts:
 * - SmartCompactionEngine should not know about WS / fleet plumbing.
 *   Strict separation: the engine fires domain events; this module
 *   adapts them to the fleet wire format.
 * - Symmetric with heartbeat-broadcaster.ts (Phase (d).9): both are
 *   small "system event" bridges from internal subsystems to the
 *   fleet bus.
 * - Future extension point: same pattern can wrap memory.compact,
 *   plugin.reload, or any other "I'm briefly indisposed" lifecycle.
 *
 * Idempotent: wireCompactionBridge() called twice is a no-op (we keep
 * a module-level `wired` flag and the same listener references for
 * later off()).
 */

import {
  broadcastCompactionStart,
  broadcastCompactionComplete,
} from '../server/websocket/fleet-bridge.js';
import { getSmartCompactionEngine } from '../context/smart-compaction.js';
import { logger } from '../utils/logger.js';

// Engine event payload shapes — narrow to what we actually forward.
interface CompactionStartPayload {
  messageCount?: number;
  tokens?: number;
}
interface CompactionCompletePayload {
  success?: boolean;
  originalTokens?: number;
  compactedTokens?: number;
  messagesRemoved?: number;
  strategy?: string;
  durationMs?: number;
}

let wired = false;
// Hold the bound listeners so we can off() them precisely on unwire.
// Inline arrow refs would not be removable from the engine.
let onStart: ((payload: CompactionStartPayload) => void) | null = null;
let onComplete: ((payload: CompactionCompletePayload) => void) | null = null;

/**
 * Attach fleet broadcasts on the SmartCompactionEngine singleton. Calls
 * to broadcastCompaction* are best-effort (the broadcast helper swallows
 * server-not-running errors), so this is safe to call even when the WS
 * server isn't actually up — useful for tests.
 */
export function wireCompactionBridge(): void {
  if (wired) {
    logger.debug('[fleet-compaction-bridge] wire() called while already wired — no-op');
    return;
  }
  const engine = getSmartCompactionEngine();
  onStart = (payload: CompactionStartPayload) => {
    try {
      broadcastCompactionStart({
        messageCount: payload?.messageCount,
        tokens: payload?.tokens,
      });
    } catch (err) {
      logger.debug('[fleet-compaction-bridge] start broadcast failed (ignored)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
  onComplete = (payload: CompactionCompletePayload) => {
    try {
      broadcastCompactionComplete({
        success: payload?.success,
        originalTokens: payload?.originalTokens,
        compactedTokens: payload?.compactedTokens,
        messagesRemoved: payload?.messagesRemoved,
        strategy: payload?.strategy,
        durationMs: payload?.durationMs,
      });
    } catch (err) {
      logger.debug('[fleet-compaction-bridge] complete broadcast failed (ignored)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
  engine.on('compaction:start', onStart);
  engine.on('compaction:complete', onComplete);
  wired = true;
  logger.debug('[fleet-compaction-bridge] wired');
}

/**
 * Detach the listeners installed by wireCompactionBridge(). Idempotent.
 */
export function unwireCompactionBridge(): void {
  if (!wired) return;
  const engine = getSmartCompactionEngine();
  if (onStart) engine.off('compaction:start', onStart);
  if (onComplete) engine.off('compaction:complete', onComplete);
  onStart = null;
  onComplete = null;
  wired = false;
  logger.debug('[fleet-compaction-bridge] unwired');
}

/** Whether the bridge is currently attached to the engine. */
export function isCompactionBridgeWired(): boolean {
  return wired;
}

/** Test-only reset hook. */
export function _unwireForTests(): void {
  // Force the off() path even if wired flag is desync'd from real state.
  if (onStart || onComplete) {
    try {
      const engine = getSmartCompactionEngine();
      if (onStart) engine.off('compaction:start', onStart);
      if (onComplete) engine.off('compaction:complete', onComplete);
    } catch {
      /* engine may be unavailable in some test setups */
    }
  }
  onStart = null;
  onComplete = null;
  wired = false;
}
