/**
 * os-ipc council health — real test (no mocks beyond electron): reads REAL
 * temp JSONL ledgers shaped exactly like ~/.codebuddy's (verbatim lines from
 * production) and asserts the arena session mapping.
 */
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { readCouncilHealth } from '../src/main/ipc/os-ipc';

const HEALTH_LINES = [
  '{"at":"2026-07-01T22:10:31.900Z","taskType":"french","planMode":"collective","seats":3,"answers":3,"seatSurvival":1,"judgeAlive":1,"stanceDivergence":0.927,"judgeDiscrimination":0.4,"dissentRetention":0.253,"anchorRatio":0.159,"dhi":0.8318528867824643}',
  '{"at":"2026-07-01T22:51:16.126Z","taskType":"code","planMode":"collective","seats":3,"answers":3,"seatSurvival":1,"judgeAlive":1,"stanceDivergence":0.5,"judgeDiscrimination":0.2,"dissentRetention":0.4,"anchorRatio":0.3,"dhi":0.61}',
].join('\n');

const SCOREBOARD_LINES = [
  // Same run as the LAST health line (within the 90s window)
  '{"at":"2026-07-01T22:51:16.125Z","taskType":"code","model":"grok-4-latest","provider":"grok","role":"reviewer","won":false,"quality":0.2,"roleQuality":0.95,"latencyMs":7908,"costUsd":0.0002}',
  '{"at":"2026-07-01T22:51:16.125Z","taskType":"code","model":"gpt-5.5","provider":"chatgpt","role":"member","won":true,"quality":0.9,"roleQuality":0.8,"latencyMs":5120,"costUsd":0}',
  '{"at":"2026-07-01T22:51:16.125Z","taskType":"code","model":"qwen3.6:27b","provider":"ollama","role":"member","won":false,"quality":0.6,"roleQuality":0.5,"latencyMs":9800,"costUsd":0}',
  // A FAILED seat in the same window → excluded
  '{"at":"2026-07-01T22:51:16.125Z","taskType":"code","model":"dead-model","provider":"x","role":"member","won":false,"quality":0,"failed":true}',
  // An OLD run far outside the window → excluded
  '{"at":"2026-07-01T22:10:31.899Z","taskType":"french","model":"gemma4","provider":"ollama","role":"member","won":true,"quality":0.8}',
].join('\n');

function makeLedgerDir(health = HEALTH_LINES, scoreboard = SCOREBOARD_LINES): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-ipc-test-'));
  writeFileSync(join(dir, 'council-deliberation-health.jsonl'), health);
  writeFileSync(join(dir, 'fleet-model-performance.jsonl'), scoreboard);
  return dir;
}

describe('readCouncilHealth', () => {
  it('maps the LAST run to an arena session with its verdicts only', async () => {
    const { session, history } = await readCouncilHealth(20, makeLedgerDir());
    expect(session).not.toBeNull();
    expect(session!.dhi).toBeCloseTo(0.61);
    expect(session!.title).toContain('code');
    expect(session!.title).toContain('3/3');
    // 3 live seats — the failed one and the older run are excluded.
    expect(session!.verdicts).toHaveLength(3);
    const winner = session!.verdicts.find((v) => v.stance === 'approve');
    expect(winner?.model).toBe('gpt-5.5');
    expect(session!.verdicts.find((v) => v.model === 'grok-4-latest')?.stance).toBe('reject'); // 0.2 < 0.5
    expect(session!.verdicts.find((v) => v.model === 'qwen3.6:27b')?.stance).toBe('revise'); // 0.6, not won
    // agentIds unique (keyed in the arena grid)
    expect(new Set(session!.verdicts.map((v) => v.agentId)).size).toBe(3);
    // History oldest → newest
    expect(history.map((h) => h.dhi)).toEqual([0.8318528867824643, 0.61]);
  });

  it('is fail-open: missing files → null session, corrupt lines skipped', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'os-ipc-empty-'));
    expect(await readCouncilHealth(20, empty)).toEqual({ session: null, history: [] });

    const corrupt = makeLedgerDir('{oops\n' + HEALTH_LINES, '{nope\n' + SCOREBOARD_LINES);
    const { session } = await readCouncilHealth(20, corrupt);
    expect(session!.verdicts).toHaveLength(3);
  });

  it('caps the history to the requested limit', async () => {
    const { history } = await readCouncilHealth(1, makeLedgerDir());
    expect(history).toHaveLength(1);
    expect(history[0]!.dhi).toBe(0.61);
  });
});
