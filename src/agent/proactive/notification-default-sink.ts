/**
 * Default notification sink — Phase (d).21 ship 3.
 *
 * Activates `NotificationManager` (previously dormant: registered but no
 * callers). The sink:
 *   - exposes a single `notify()` helper that the rest of the codebase
 *     can call without touching the manager directly
 *   - applies `shouldSend()` gates (channel allowlist, quiet hours,
 *     rate limit)
 *   - logs allowed notifications via `logger.info` (low/normal) or
 *     `logger.warn` (high/urgent) so they're visible in the existing
 *     log stream; future Cowork IPC bridge can register a richer sink
 *     by listening on `manager.on('notification:emitted', ...)`.
 *   - records every attempt in the manager's history (delivered=true
 *     when allowed, false when gated, for accurate rate-limit math).
 *
 * Boot wiring: `codebuddy-agent.ts` calls `wireDefaultNotificationSink()`
 * once at startup. Idempotent.
 *
 * @module src/agent/proactive/notification-default-sink
 */

import { getNotificationManager } from './notification-manager.js';
import type { ProactiveMessage } from './proactive-agent.js';
import { logger } from '../../utils/logger.js';

let wired = false;

/**
 * Register the default log-based sink. Idempotent — second call is a
 * no-op so the boot path can call it unconditionally.
 */
export function wireDefaultNotificationSink(): void {
  if (wired) return;
  wired = true;
  // No-op subscription just to mark the manager as "active". Future
  // sinks (Cowork IPC, system tray) can register their own listeners
  // on the same EventEmitter instance.
  getNotificationManager();
}

/**
 * Send a notification through the manager + default log sink.
 * Returns `true` when delivered, `false` when gated (or wrapped error).
 *
 * Quick-fire helper for callers that don't want to construct a full
 * `ProactiveMessage` — `notifyQuick` below covers the common case.
 */
export function notify(msg: ProactiveMessage): boolean {
  const mgr = getNotificationManager();
  const verdict = mgr.shouldSend(msg);
  if (!verdict.allowed) {
    mgr.record(msg, false);
    logger.debug?.('[notification] gated', {
      reason: verdict.reason,
      priority: msg.priority,
      channel: msg.channelType,
    });
    return false;
  }
  // Default log sink — visible in existing logger stream.
  const logFn = msg.priority === 'high' || msg.priority === 'urgent'
    ? logger.warn
    : logger.info;
  logFn?.(`[notification] ${msg.message}`, {
    priority: msg.priority,
    channel: msg.channelType,
  });
  mgr.record(msg, true);
  // Emit for any non-default sinks attached via .on('notification:emitted').
  mgr.emit('notification:emitted', msg);
  return true;
}

/**
 * Convenience wrapper for the most common case: a CLI-channel
 * notification with just a message + priority.
 */
export function notifyQuick(
  message: string,
  priority: ProactiveMessage['priority'] = 'normal',
): boolean {
  return notify({
    channelType: 'cli',
    channelId: 'default',
    message,
    priority,
  });
}

/** Test-only — drop the wired flag so a fresh wire() call wakes again. */
export function _resetForTests(): void {
  wired = false;
}
