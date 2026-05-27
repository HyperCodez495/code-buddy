/**
 * Bridges {@link SmartCompactionEngine} lifecycle events onto the generic
 * {@link ProgressManager}, so a long context compaction shows up as a normal
 * progress task (animated bar + elapsed) in any renderer — the first concrete
 * consumer of the progress library.
 *
 * Why start on `compaction:strategy` and not `compaction:start`:
 * `compact()` always emits `compaction:start`, but on the no-op path (tokens
 * already under target) it returns *without* emitting `compaction:complete`.
 * `compaction:strategy` only fires once real work has been chosen, so anchoring
 * the task to it means a no-op compaction never leaves a task dangling.
 */
import type { EventEmitter } from 'node:events';
import { formatTokenCount } from '../utils/token-counter.js';
import { getProgressManager, type ProgressTask } from '../utils/progress/index.js';

interface CompactionCompletePayload {
  originalTokens?: number;
  compactedTokens?: number;
  success?: boolean;
}

/** A SmartCompactionEngine, minimally typed to the events we listen to. */
type CompactionEventSource = Pick<EventEmitter, 'on' | 'off'>;

/**
 * Attach progress reporting to a compaction engine. Returns an unwire function.
 * Safe to call once per engine instance; double-wiring the same engine would
 * double-count, so wire at engine-construction sites only.
 */
export function wireCompactionProgress(engine: CompactionEventSource): () => void {
  const mgr = getProgressManager();
  let current: ProgressTask | null = null;

  const onStrategy = (): void => {
    // Defensive: if a previous task somehow never completed, close it first.
    if (current && !current.isTerminal) current.complete();
    current = mgr.start({
      kind: 'compaction',
      label: 'Compacting conversation…',
      mode: 'time-anchored',
      watchdogMs: 120_000,
    });
  };

  const onComplete = (payload: CompactionCompletePayload = {}): void => {
    if (!current || current.isTerminal) {
      current = null;
      return;
    }
    const { originalTokens: o, compactedTokens: c } = payload;
    const message =
      typeof o === 'number' && typeof c === 'number'
        ? `Compacted ${formatTokenCount(o)} → ${formatTokenCount(c)} tokens`
        : 'Compaction complete';
    if (payload.success === false) current.fail(message);
    else current.complete(message);
    current = null;
  };

  engine.on('compaction:strategy', onStrategy);
  engine.on('compaction:complete', onComplete);

  return () => {
    engine.off('compaction:strategy', onStrategy);
    engine.off('compaction:complete', onComplete);
  };
}
