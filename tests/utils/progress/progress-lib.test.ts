import { describe, it, expect, beforeEach } from 'vitest';
import {
  median,
  DurationEstimator,
} from '../../../src/utils/progress/duration-estimator.js';
import {
  formatElapsed,
  renderBar,
  renderIndeterminateBar,
  spinnerFrame,
  renderProgressLines,
  renderTodoLines,
  STAR_FRAMES,
  BAR_FILLED,
  BAR_EMPTY,
} from '../../../src/utils/progress/render.js';
import { ProgressTask, TIME_ANCHORED_CAP } from '../../../src/utils/progress/progress-task.js';
import { ProgressManager } from '../../../src/utils/progress/progress-manager.js';

describe('median', () => {
  it('returns 0 for empty input', () => {
    expect(median([])).toBe(0);
  });
  it('handles odd and even lengths regardless of order', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('DurationEstimator', () => {
  it('uses per-kind default before any sample, then the rolling median', () => {
    const est = new DurationEstimator({ defaults: { compaction: 30_000 }, fallbackMs: 10_000 });
    expect(est.estimate('compaction')).toBe(30_000);
    expect(est.estimate('unknown')).toBe(10_000);
    est.record('compaction', 40_000);
    est.record('compaction', 60_000);
    expect(est.estimate('compaction')).toBe(50_000);
  });
  it('ignores non-positive / non-finite samples', () => {
    const est = new DurationEstimator({ fallbackMs: 1_000 });
    est.record('k', 0);
    est.record('k', -5);
    est.record('k', Number.NaN);
    expect(est.estimate('k')).toBe(1_000);
  });
  it('caps history at maxSamples (drops oldest)', () => {
    const est = new DurationEstimator({ maxSamples: 2 });
    est.record('k', 10);
    est.record('k', 20);
    est.record('k', 30); // 10 dropped -> [20, 30]
    expect(est.estimate('k')).toBe(25);
  });
});

describe('formatElapsed', () => {
  it('formats seconds, minutes, and hours', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(41_000)).toBe('41s');
    expect(formatElapsed(425_000)).toBe('7m 5s'); // matches the screenshot
    expect(formatElapsed(3_720_000)).toBe('1h02m');
  });
});

describe('renderBar', () => {
  it('fills proportionally and clamps out-of-range', () => {
    expect(renderBar(0, 10)).toBe(BAR_EMPTY.repeat(10));
    expect(renderBar(100, 10)).toBe(BAR_FILLED.repeat(10));
    expect(renderBar(50, 10)).toBe(BAR_FILLED.repeat(5) + BAR_EMPTY.repeat(5));
    expect(renderBar(150, 10)).toBe(BAR_FILLED.repeat(10));
    expect(renderBar(-5, 10)).toBe(BAR_EMPTY.repeat(10));
  });
  it('always returns exactly `width` cells', () => {
    for (const p of [0, 13, 37, 64, 99, 100]) {
      expect([...renderBar(p, 28)].length).toBe(28);
    }
  });
});

describe('renderIndeterminateBar', () => {
  it('keeps constant width and a lit window that moves', () => {
    const a = renderIndeterminateBar(0, 20);
    const b = renderIndeterminateBar(5, 20);
    expect([...a].length).toBe(20);
    expect([...b].length).toBe(20);
    expect(a.includes(BAR_FILLED)).toBe(true);
    expect(a).not.toBe(b); // window advanced
  });
});

describe('spinnerFrame', () => {
  it('cycles through STAR_FRAMES and tolerates negative input', () => {
    expect(spinnerFrame(0)).toBe(STAR_FRAMES[0]);
    expect(spinnerFrame(STAR_FRAMES.length)).toBe(STAR_FRAMES[0]);
    expect(spinnerFrame(-1)).toBe(STAR_FRAMES[STAR_FRAMES.length - 1]);
  });
});

describe('ProgressTask — time-anchored', () => {
  const t0 = 1_000_000;
  function task(estimateMs: number) {
    return new ProgressTask(
      { kind: 'compaction', label: 'Compacting conversation…', mode: 'time-anchored', estimateMs },
      t0,
    );
  }

  it('grows percent from elapsed/estimate but caps below 100 while running', () => {
    const t = task(40_000);
    expect(t.snapshot(t0).percent).toBe(0);
    expect(t.snapshot(t0 + 20_000).percent).toBe(50);
    // 40s elapsed on a 40s estimate would be 100%, but it caps.
    expect(t.snapshot(t0 + 40_000).percent).toBe(TIME_ANCHORED_CAP);
    expect(t.snapshot(t0 + 120_000).percent).toBe(TIME_ANCHORED_CAP);
  });

  it('snaps to 100 on complete and exposes elapsed at the completion instant', () => {
    const t = task(40_000);
    t.complete('Compacted 84k → 12k tokens', t0 + 47_000);
    const snap = t.snapshot(t0 + 99_000);
    expect(snap.percent).toBe(100);
    expect(snap.status).toBe('complete');
    expect(snap.elapsedMs).toBe(47_000); // frozen at endedAt, not "now"
    expect(snap.message).toBe('Compacted 84k → 12k tokens');
  });

  it('reports eta as estimate minus elapsed', () => {
    const t = task(40_000);
    expect(t.snapshot(t0 + 10_000).etaMs).toBe(30_000);
  });
});

describe('ProgressTask — determinate & indeterminate', () => {
  it('determinate derives percent from current/total', () => {
    const t = new ProgressTask({ kind: 'index', label: 'Indexing', mode: 'determinate', total: 200 }, 0);
    t.update({ current: 50 }, 1_000);
    const snap = t.snapshot(1_000);
    expect(snap.percent).toBe(25);
    expect(snap.etaMs).toBe(3_000); // 50 items in 1s -> 150 left -> 3s
  });
  it('indeterminate has null percent and eta', () => {
    const t = new ProgressTask({ kind: 'call', label: 'Calling', mode: 'indeterminate' }, 0);
    const snap = t.snapshot(5_000);
    expect(snap.percent).toBeNull();
    expect(snap.etaMs).toBeNull();
  });
});

describe('renderProgressLines', () => {
  const base = new ProgressTask(
    { kind: 'compaction', label: 'Compacting conversation…', mode: 'time-anchored', estimateMs: 40_000, nextHint: 'P0b — Re-résolution' },
    0,
  );
  it('renders head + bar + Next while running', () => {
    const lines = renderProgressLines(base.snapshot(15_000), { width: 28, frame: 0 });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Compacting conversation…');
    expect(lines[0]).toContain('(15s)');
    expect(lines[1]).toMatch(/38%$/); // 15/40 = 37.5 -> round -> 38
    expect(lines[2]).toBe('  ⎿  Next: P0b — Re-résolution');
  });
  it('omits the Next line when no hint', () => {
    const t = new ProgressTask({ kind: 'compaction', label: 'Compacting…', mode: 'time-anchored', estimateMs: 40_000 }, 0);
    const lines = renderProgressLines(t.snapshot(10_000));
    expect(lines).toHaveLength(2);
  });
  it('shows a checkmark + message on completion', () => {
    const t = new ProgressTask({ kind: 'compaction', label: 'Compacting…', mode: 'time-anchored', estimateMs: 40_000 }, 0);
    t.complete('Compacted 84k → 12k tokens', 47_000);
    const lines = renderProgressLines(t.snapshot(47_000));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('✔ Compacted 84k → 12k tokens');
  });
});

describe('renderTodoLines', () => {
  it('returns nothing for an empty list', () => {
    expect(renderTodoLines([])).toEqual([]);
  });
  it('shows active items and summarises overflow completed', () => {
    const lines = renderTodoLines(
      [
        { label: 'P0b', status: 'pending' },
        { label: 'P0c', status: 'pending' },
        { label: 'P0a', status: 'completed' },
        { label: 'P0d', status: 'completed' },
        { label: 'P0e', status: 'completed' },
        { label: 'Browser', status: 'completed' },
        { label: 'Avalonia', status: 'completed' },
      ],
      { maxVisible: 5 },
    );
    // 2 active + 3 completed visible + overflow footer
    expect(lines[0]).toContain('◻ P0b');
    expect(lines[1]).toContain('◻ P0c');
    expect(lines.some((l) => l.includes('✔ P0a'))).toBe(true);
    expect(lines[lines.length - 1]).toContain('… +2 completed');
  });
});

describe('ProgressManager', () => {
  let mgr: ProgressManager;
  beforeEach(() => {
    mgr = new ProgressManager({ lingerMs: 0 });
  });

  it('fills the time-anchored estimate from the per-kind default', () => {
    const task = mgr.start({ kind: 'compaction', label: 'Compacting…', mode: 'time-anchored' });
    expect(task.estimateMs).toBe(30_000);
    task.complete();
  });

  it('emits start/update then end, and records a completed duration into the estimate', () => {
    const events: string[] = [];
    mgr.on('start', () => events.push('start'));
    mgr.on('update', () => events.push('update'));
    mgr.on('end', () => events.push('end'));

    const task = mgr.start({ kind: 'compaction', label: 'Compacting…', mode: 'time-anchored' });
    // Force a known 50s duration so the recorded median is deterministic.
    task.complete('done', task.startedAt + 50_000);

    expect(events).toContain('start');
    expect(events).toContain('update');
    expect(events).toContain('end'); // lingerMs:0 -> removed synchronously

    const next = mgr.start({ kind: 'compaction', label: 'Compacting…', mode: 'time-anchored' });
    expect(next.estimateMs).toBe(50_000); // history of [50s] now drives the estimate
    next.complete();
  });

  it('getMostRecent reflects the latest running task', () => {
    expect(mgr.getMostRecent()).toBeNull();
    const a = mgr.start({ kind: 'a', label: 'A' });
    const b = mgr.start({ kind: 'b', label: 'B' });
    expect(mgr.getMostRecent()?.kind).toBe('b');
    b.complete();
    expect(mgr.getMostRecent()?.kind).toBe('a');
    a.complete();
    expect(mgr.getMostRecent()).toBeNull();
  });
});
