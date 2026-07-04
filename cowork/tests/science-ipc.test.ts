import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture every ipcMain.handle(channel, handler) into a map so we can invoke the
// registered handlers directly (mirrors tests/mission-ipc.test.ts).
const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };
});

vi.mock('electron', () => ({ ipcMain: { handle: electronMock.handle } }));

import { registerScienceIpcHandlers } from '../src/main/ipc/science-ipc';

/** Write a JSONL variant store under `<base>/.codebuddy/science/experiment-variants.json`. */
function writeStore(base: string, lines: string[]): string {
  const dir = path.join(base, '.codebuddy', 'science');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'experiment-variants.json');
  writeFileSync(file, lines.join('\n') + (lines.length ? '\n' : ''));
  return file;
}

function variant(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'v-root-0000',
    hypothesis: 'A larger batch improves accuracy',
    code: 'print("accuracy: 0.80")',
    language: 'python',
    executionResult: { ok: true, exitCode: 0, timedOut: false, runId: 'run-1', runDir: '/tmp/run-1', durationMs: 42 },
    metric: { name: 'accuracy', value: 0.8, score: 0.8, detail: 'parsed 0.80' },
    score: 0.8,
    passedAll: true,
    regressions: [],
    kept: false,
    createdAt: '2026-07-01T10:00:00.000Z',
    ...over,
  });
}

let tmp: string;

beforeEach(() => {
  electronMock.handlers.clear();
  electronMock.handle.mockClear();
  tmp = mkdtempSync(path.join(tmpdir(), 'science-ipc-'));
});

afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe('science IPC handlers', () => {
  it('registers only read-only channels — no run/start/execute handler is exposed', () => {
    registerScienceIpcHandlers();
    const channels = [...electronMock.handlers.keys()].sort();
    expect(channels).toEqual(['science.listVariants', 'science.status']);
    // Defence in depth: assert nothing that could launch an experiment slipped in.
    for (const ch of channels) {
      expect(ch).not.toMatch(/run|start|exec|launch|create|write|delete/i);
    }
  });

  it('lists the variants of a JSONL fixture store + the best variant + a summary', async () => {
    writeStore(tmp, [
      variant(), // passing root, score 0.8
      variant({
        id: 'v-child-0001',
        parentId: 'v-root-0000',
        hypothesis: 'An even larger batch',
        score: 0.9,
        metric: { name: 'accuracy', value: 0.9, score: 0.9 },
        createdAt: '2026-07-01T11:00:00.000Z',
      }), // passing child, score 0.9 → the best
      variant({
        id: 'v-bad-0002',
        score: 0.95,
        passedAll: false,
        regressions: ['speed'],
        createdAt: '2026-07-01T12:00:00.000Z',
      }), // higher score but regressed → NOT eligible for best
    ]);

    registerScienceIpcHandlers();
    const handler = electronMock.handlers.get('science.listVariants');
    expect(handler).toBeDefined();

    const res = (await handler?.({}, tmp)) as {
      variants: Array<{ id: string; parentId?: string; passedAll: boolean }>;
      best: { id: string; score: number } | null;
      summary: { total: number; passed: number; kept: number; bestScore: number | null; exists: boolean; storePath: string };
    };

    expect(res.variants).toHaveLength(3);
    expect(res.variants.map((v) => v.id)).toEqual(['v-root-0000', 'v-child-0001', 'v-bad-0002']);
    // Lineage is preserved.
    expect(res.variants.find((v) => v.id === 'v-child-0001')?.parentId).toBe('v-root-0000');
    // Best = highest-scoring passing, no-regression variant (0.9), NOT the regressed 0.95.
    expect(res.best?.id).toBe('v-child-0001');
    expect(res.best?.score).toBeCloseTo(0.9);
    // Summary roll-up.
    expect(res.summary.total).toBe(3);
    expect(res.summary.passed).toBe(2);
    expect(res.summary.kept).toBe(0);
    expect(res.summary.bestScore).toBeCloseTo(0.9);
    expect(res.summary.exists).toBe(true);
    expect(res.summary.storePath).toContain(path.join('.codebuddy', 'science', 'experiment-variants.json'));
  });

  it('reads the legacy single-object store format', async () => {
    const dir = path.join(tmp, '.codebuddy', 'science');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'experiment-variants.json'),
      JSON.stringify({ schemaVersion: 1, variants: [JSON.parse(variant())] }),
    );

    registerScienceIpcHandlers();
    const res = (await electronMock.handlers.get('science.listVariants')?.({}, tmp)) as {
      variants: unknown[];
      best: { id: string } | null;
    };
    expect(res.variants).toHaveLength(1);
    expect(res.best?.id).toBe('v-root-0000');
  });

  it('returns an empty result (no throw) when the store is absent', async () => {
    registerScienceIpcHandlers();
    const res = (await electronMock.handlers.get('science.listVariants')?.({}, tmp)) as {
      variants: unknown[];
      best: unknown;
      summary: { total: number; exists: boolean };
    };
    expect(res.variants).toEqual([]);
    expect(res.best).toBeNull();
    expect(res.summary.total).toBe(0);
    expect(res.summary.exists).toBe(false);
  });

  it('returns an empty result (no throw) when the store is empty / whitespace', async () => {
    writeStore(tmp, []); // creates the file with no lines
    writeFileSync(path.join(tmp, '.codebuddy', 'science', 'experiment-variants.json'), '   \n  ');

    registerScienceIpcHandlers();
    const res = (await electronMock.handlers.get('science.listVariants')?.({}, tmp)) as {
      variants: unknown[];
      summary: { total: number; exists: boolean };
    };
    expect(res.variants).toEqual([]);
    expect(res.summary.total).toBe(0);
    // The file exists but holds no variants.
    expect(res.summary.exists).toBe(true);
  });

  it('skips a torn/corrupt JSONL line without nuking the whole store', async () => {
    writeStore(tmp, [variant(), '{ this is not json', variant({ id: 'v-ok-0003', createdAt: '2026-07-02T10:00:00.000Z' })]);

    registerScienceIpcHandlers();
    const res = (await electronMock.handlers.get('science.listVariants')?.({}, tmp)) as {
      variants: Array<{ id: string }>;
    };
    expect(res.variants.map((v) => v.id)).toEqual(['v-root-0000', 'v-ok-0003']);
  });

  it('science.status returns the lightweight summary', async () => {
    writeStore(tmp, [variant({ kept: true })]);

    registerScienceIpcHandlers();
    const summary = (await electronMock.handlers.get('science.status')?.({}, tmp)) as {
      total: number;
      passed: number;
      kept: number;
      bestScore: number | null;
      exists: boolean;
    };
    expect(summary.total).toBe(1);
    expect(summary.passed).toBe(1);
    expect(summary.kept).toBe(1);
    expect(summary.bestScore).toBeCloseTo(0.8);
    expect(summary.exists).toBe(true);
  });
});
