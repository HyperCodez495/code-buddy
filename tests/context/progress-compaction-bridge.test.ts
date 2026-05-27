import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { wireCompactionProgress } from '../../src/context/progress-compaction-bridge.js';
import {
  ProgressManager,
  __setProgressManagerForTests,
  type ProgressSnapshot,
} from '../../src/utils/progress/index.js';

describe('wireCompactionProgress', () => {
  let mgr: ProgressManager;
  beforeEach(() => {
    mgr = new ProgressManager({ lingerMs: 0 });
    __setProgressManagerForTests(mgr);
  });
  afterEach(() => {
    __setProgressManagerForTests(null);
  });

  it('starts a task on strategy and completes it with a token summary', () => {
    const engine = new EventEmitter();
    wireCompactionProgress(engine);
    const ends: ProgressSnapshot[] = [];
    mgr.on('end', (s) => ends.push(s));

    engine.emit('compaction:strategy', { strategy: 'summarize' });
    expect(mgr.getMostRecent()?.kind).toBe('compaction');
    expect(mgr.getMostRecent()?.label).toBe('Compacting conversation…');
    expect(mgr.getMostRecent()?.mode).toBe('time-anchored');

    engine.emit('compaction:complete', {
      originalTokens: 84_000,
      compactedTokens: 12_000,
      success: true,
      durationMs: 100,
    });

    expect(ends).toHaveLength(1);
    expect(ends[0]!.status).toBe('complete');
    expect(ends[0]!.percent).toBe(100);
    expect(ends[0]!.message).toContain('→');
    expect(mgr.getMostRecent()).toBeNull();
  });

  it('ignores the no-op path: compaction:start alone leaves no dangling task', () => {
    const engine = new EventEmitter();
    wireCompactionProgress(engine);
    engine.emit('compaction:start', { messageCount: 3, tokens: 10 });
    expect(mgr.getMostRecent()).toBeNull();
  });

  it('marks the task failed when success is false', () => {
    const engine = new EventEmitter();
    wireCompactionProgress(engine);
    const ends: ProgressSnapshot[] = [];
    mgr.on('end', (s) => ends.push(s));
    engine.emit('compaction:strategy', { strategy: 'aggressive' });
    engine.emit('compaction:complete', { originalTokens: 100, compactedTokens: 90, success: false });
    expect(ends[0]!.status).toBe('error');
  });

  it('unwire stops further reporting', () => {
    const engine = new EventEmitter();
    const unwire = wireCompactionProgress(engine);
    unwire();
    engine.emit('compaction:strategy', { strategy: 'summarize' });
    expect(mgr.getMostRecent()).toBeNull();
  });
});
