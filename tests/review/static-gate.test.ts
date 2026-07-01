/**
 * Static gate — deterministic zero-LLM checks, blockers reject without
 * spending a reviewer token.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { runStaticGate } from '../../src/review/static-gate.js';
import type { ProposedDiff, ProposedFileChange } from '../../src/review/types.js';

function change(over: Partial<ProposedFileChange> = {}): ProposedFileChange {
  return {
    path: 'src/a.ts',
    action: 'modify',
    baseContent: 'export const a = 1;\n',
    baseHash: 'abc',
    newContent: 'export const a = 2;\n',
    ...over,
  };
}

function diff(files: ProposedFileChange[]): ProposedDiff {
  return {
    id: 'diff-test',
    createdAt: '2026-07-02T00:00:00.000Z',
    workDir: '/tmp/x',
    origin: { kind: 'agent', label: 't' },
    intent: 'test',
    files,
  };
}

describe('runStaticGate', () => {
  it('accepts a clean modify', () => {
    const report = runStaticGate(diff([change()]));
    expect(report.decision).toBe('accept');
    expect(report.annotations).toEqual([]);
  });

  it('rejects omission placeholders (truncation markers) in new content', () => {
    const report = runStaticGate(
      diff([change({ newContent: 'function x() {}\n// ... rest of the code remains the same ...\n' })]),
    );
    expect(report.decision).toBe('reject');
    expect(report.annotations[0]!.severity).toBe('blocker');
    expect(report.annotations[0]!.message).toMatch(/omission/);
  });

  it('rejects INTRODUCED secrets but tolerates pre-existing ones', () => {
    const secret = 'const key = "AKIAABCDEFGHIJKLMNOP";\n';
    const introduced = runStaticGate(diff([change({ newContent: secret })]));
    expect(introduced.decision).toBe('reject');
    expect(introduced.annotations[0]!.message).toMatch(/AWS access key/);

    const preExisting = runStaticGate(diff([change({ baseContent: secret, newContent: `${secret}// touched\n` })]));
    expect(preExisting.decision).toBe('accept');
  });

  it('rejects protected paths', () => {
    const report = runStaticGate(diff([change({ path: '.git/config' })]));
    expect(report.decision).toBe('reject');
    expect(report.annotations[0]!.message).toMatch(/protected path/);
  });

  it('rejects oversized diffs (file count and byte caps)', () => {
    const many = Array.from({ length: 3 }, (_, i) => change({ path: `f${i}.ts` }));
    expect(runStaticGate(diff(many), { maxFiles: 2 }).decision).toBe('reject');

    const fat = change({ newContent: 'x'.repeat(2000) });
    expect(runStaticGate(diff([fat]), { maxTotalBytes: 100 }).decision).toBe('reject');
  });

  it('annotates a suspicious massive shrink (likely truncation)', () => {
    const base = 'line\n'.repeat(200);
    const report = runStaticGate(diff([change({ baseContent: base, newContent: 'tiny\n' })]));
    expect(report.decision).toBe('annotate');
    expect(report.annotations[0]!.severity).toBe('warning');
    expect(report.annotations[0]!.message).toMatch(/truncation/);
  });

  it('flags a no-op change as a suggestion only (does not block)', () => {
    const same = change({ newContent: 'export const a = 1;\n' });
    const report = runStaticGate(diff([same]));
    expect(report.decision).toBe('accept');
    expect(report.annotations[0]!.severity).toBe('suggestion');
  });
});
