/**
 * Session Duration Middleware (WS3-T3 — auto-pause & resume)
 *
 * Very long sessions (12 h+) degrade context quality and pile up risk.
 * Past a configurable threshold this middleware suggests a clean pause,
 * takes a fresh context snapshot as the resume point (WS3-T2), and
 * reminds periodically instead of nagging every turn.
 *
 * It never stops the loop — pausing stays the operator's decision; the
 * autonomous runner has its own bounded budgets (WS1).
 *
 * @module agent/middleware
 */

import { ConversationMiddleware, MiddlewareContext, MiddlewareResult } from './types.js';
import { RunStore } from '../../observability/run-store.js';
import { logger } from '../../utils/logger.js';

export interface SessionDurationOptions {
  /** Pause-suggestion threshold in ms. Default: CODEBUDDY_SESSION_PAUSE_HOURS (12 h); 0 disables. */
  maxSessionMs?: number;
  /** Re-warn cadence once past the threshold. Default 60 min. */
  remindEveryMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
  /** Take a fresh context snapshot when the pause is suggested (WS3-T2 hook). */
  takeSnapshot?: () => void;
}

const HOUR_MS = 3_600_000;

function defaultThresholdMs(): number {
  const hours = parseFloat(process.env.CODEBUDDY_SESSION_PAUSE_HOURS || '12');
  if (!Number.isFinite(hours) || hours <= 0) return 0; // 0/invalid → disabled
  return hours * HOUR_MS;
}

export class SessionDurationMiddleware implements ConversationMiddleware {
  readonly name = 'session-duration';
  readonly priority = 35;

  private readonly startedAt: number;
  private readonly thresholdMs: number;
  private readonly remindEveryMs: number;
  private readonly now: () => number;
  private readonly takeSnapshot: (() => void) | undefined;
  private lastWarnedAt: number | null = null;

  constructor(options: SessionDurationOptions = {}) {
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    this.thresholdMs = options.maxSessionMs ?? defaultThresholdMs();
    this.remindEveryMs = options.remindEveryMs ?? HOUR_MS;
    this.takeSnapshot = options.takeSnapshot;
  }

  beforeTurn(_context: MiddlewareContext): MiddlewareResult {
    if (this.thresholdMs <= 0) return { action: 'continue' };

    const elapsed = this.now() - this.startedAt;
    if (elapsed < this.thresholdMs) return { action: 'continue' };
    if (this.lastWarnedAt !== null && this.now() - this.lastWarnedAt < this.remindEveryMs) {
      return { action: 'continue' };
    }
    this.lastWarnedAt = this.now();

    // Fresh resume point right when the pause is suggested.
    try {
      this.takeSnapshot?.();
    } catch (err) {
      logger.debug('[session-duration] snapshot on pause suggestion failed', { error: String(err) });
    }

    try {
      const runStore = RunStore.getInstance();
      if (runStore.getCurrentRunId()) {
        runStore.appendEvent('pause_suggested', {
          elapsedMs: elapsed,
          thresholdMs: this.thresholdMs,
        });
      }
    } catch {
      // Observability must never break the loop.
    }

    const hours = (elapsed / HOUR_MS).toFixed(1);
    return {
      action: 'warn',
      message:
        `⏸️ Session running for ${hours} h. Consider a clean pause: a fresh context ` +
        `snapshot was just written (.codebuddy/context-snapshot.json), a handoff is ` +
        `written on exit (.codebuddy/HANDOFF.md), and \`buddy --continue\` reloads the ` +
        `session. Long sessions degrade context quality — \`/compact\` also helps.`,
    };
  }
}
