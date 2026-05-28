/**
 * Session-compaction fork recording (S7 / Hermes parity item 22).
 *
 * `RunStore.forkRun` already records a parent→child link with a reason; the
 * remaining gap was that session compaction never emitted one. This helper is
 * the guarded bridge: when a compaction happens during an active observability
 * run, it forks the run so lineage (`buddy run lineage`) shows the compaction
 * boundary. It is a deliberate NO-OP when there is no active run (the common
 * interactive case), so normal sessions are unaffected, and it never throws —
 * lineage bookkeeping must never break a turn.
 *
 * @module context/compaction-fork
 */

import { logger } from '../utils/logger.js';

export interface ForkableRunStore {
  forkRun(parentRunId: string, reason: string, overrides?: Record<string, unknown>): string;
}

/**
 * Fork the active run to mark a compaction boundary.
 *
 * @returns the new fork run id, or null when there is no active run/store or the
 * fork failed (always safe — callers should re-point their runId only on a
 * non-null result).
 */
export function recordCompactionFork(
  store: ForkableRunStore | null | undefined,
  runId: string | undefined,
  reason = 'compaction',
): string | null {
  if (!store || !runId) return null;
  try {
    return store.forkRun(runId, reason);
  } catch (err) {
    logger.debug('recordCompactionFork: forkRun failed', { err });
    return null;
  }
}
