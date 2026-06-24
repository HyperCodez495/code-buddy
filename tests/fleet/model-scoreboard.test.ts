/**
 * Model scoreboard tests — the learning layer for `buddy council`.
 * Each test uses a tmp ledger file so they're hermetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { ModelScoreboard, type OutcomeRecord } from '../../src/fleet/model-scoreboard';

let tmpFile: string;

function rec(over: Partial<OutcomeRecord>): OutcomeRecord {
  return {
    at: '2026-06-24T00:00:00.000Z',
    taskType: 'code',
    model: 'grok-3',
    provider: 'grok',
    won: false,
    quality: 0.5,
    latencyMs: 1000,
    costUsd: 0,
    ...over,
  };
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-scoreboard-'));
  tmpFile = path.join(dir, 'perf.json');
});

afterEach(() => {
  try {
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('ModelScoreboard', () => {
  it('persists outcomes to disk and reloads them', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ won: true }));
    expect(fs.existsSync(tmpFile)).toBe(true);

    const fresh = new ModelScoreboard(tmpFile);
    expect(fresh.ranking('code')).toHaveLength(1);
    expect(fresh.ranking('code')[0]!.model).toBe('grok-3');
  });

  it('computes win rate per (taskType, model)', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ won: true }));
    sb.recordOutcome(rec({ won: false }));
    sb.recordOutcome(rec({ won: true }));
    expect(sb.winRate('code', 'grok-3')).toBeCloseTo(2 / 3, 5);
    expect(sb.winRate('code', 'unseen-model')).toBe(0);
    expect(sb.winRate('french', 'grok-3')).toBe(0); // different task type
  });

  it('isolates win rates by task type', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ taskType: 'code', won: true }));
    sb.recordOutcome(rec({ taskType: 'french', won: false }));
    expect(sb.winRate('code', 'grok-3')).toBe(1);
    expect(sb.winRate('french', 'grok-3')).toBe(0);
  });

  it('ranks models by win rate then quality', () => {
    const sb = new ModelScoreboard(tmpFile);
    // grok: 1 win / 1; gpt: 0 win / 1 but higher quality
    sb.recordOutcome(rec({ model: 'grok-3', provider: 'grok', won: true, quality: 0.8 }));
    sb.recordOutcome(rec({ model: 'gpt-5.5', provider: 'chatgpt', won: false, quality: 0.95 }));
    const ranking = sb.ranking('code');
    expect(ranking.map((r) => r.model)).toEqual(['grok-3', 'gpt-5.5']);
    expect(ranking[0]!.winRate).toBe(1);
    expect(ranking[1]!.avgQuality).toBeCloseTo(0.95, 5);
  });

  it('aggregates stats across runs', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ won: true, latencyMs: 1000, quality: 1 }));
    sb.recordOutcome(rec({ won: false, latencyMs: 3000, quality: 0 }));
    const stat = sb.ranking('code')[0]!;
    expect(stat.runs).toBe(2);
    expect(stat.wins).toBe(1);
    expect(stat.winRate).toBe(0.5);
    expect(stat.avgLatencyMs).toBe(2000);
    expect(stat.avgQuality).toBe(0.5);
  });

  it('prints a friendly message when empty', () => {
    const sb = new ModelScoreboard(tmpFile);
    expect(sb.print()).toMatch(/No council history/i);
    expect(sb.print('code')).toMatch(/No council history.*code/i);
  });

  it('prints a ranking once it has data', () => {
    const sb = new ModelScoreboard(tmpFile);
    sb.recordOutcome(rec({ model: 'grok-3', won: true }));
    const out = sb.print('code');
    expect(out).toMatch(/grok-3/);
    expect(out).toMatch(/100%/);
  });
});
