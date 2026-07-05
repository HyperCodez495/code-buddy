import { describe, expect, it } from 'vitest';

import { clampProgress, formatElapsed, summarizeMissions, type Mission } from '../src/renderer/utils/mission-model';

const missions: Mission[] = [
  { id: 'm1', title: 'Run research', status: 'running', progress: 20, model: 'gpt-5.5', durationMs: 12_000 },
  { id: 'm2', title: 'Prepare deck', status: 'queued', progress: 0, model: 'local', durationMs: 0 },
  { id: 'm3', title: 'Patch UI', status: 'paused', progress: 40, model: 'codex', durationMs: 90_000 },
  { id: 'm4', title: 'Export report', status: 'done', progress: 100, model: 'gpt-5.5', durationMs: 3_600_000 },
  { id: 'm5', title: 'Call vendor', status: 'failed', progress: 55, model: 'phone-agent', durationMs: 300_000 },
];

describe('summarizeMissions', () => {
  it('counts mission statuses for dashboard summaries', () => {
    expect(summarizeMissions(missions)).toEqual({
      running: 1,
      queued: 2,
      done: 1,
      failed: 1,
    });
  });
});

describe('formatElapsed', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatElapsed(42_000)).toBe('42s');
    expect(formatElapsed(125_000)).toBe('2m 5s');
    expect(formatElapsed(7_260_000)).toBe('2h 1m');
  });

  it('handles invalid or negative durations', () => {
    expect(formatElapsed(Number.NaN)).toBe('0s');
    expect(formatElapsed(-10)).toBe('0s');
  });
});

describe('clampProgress', () => {
  it('keeps progress inside 0-100', () => {
    expect(clampProgress(-1)).toBe(0);
    expect(clampProgress(47.8)).toBe(48);
    expect(clampProgress(120)).toBe(100);
  });
});
