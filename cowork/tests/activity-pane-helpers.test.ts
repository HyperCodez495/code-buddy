import { describe, expect, it } from 'vitest';
import { traceStepToLine, activityStatus, collectSessionDiffs } from '../src/renderer/components/activity-pane-helpers';
import type { TraceStep, DiffPreview } from '../src/renderer/types';

function step(over: Partial<TraceStep>): TraceStep {
  return { id: 'x', type: 'text', status: 'completed', title: '', timestamp: 0, ...over } as TraceStep;
}

describe('traceStepToLine', () => {
  it('labels a tool call with its name and target', () => {
    const l = traceStepToLine(step({ type: 'tool_call', toolName: 'view_file', toolInput: { path: '/a/b.ts' } }));
    expect(l.label).toBe('Outil : view_file');
    expect(l.detail).toBe('/a/b.ts');
    expect(l.glyph).toBe('🔧');
  });

  it('marks an errored tool result', () => {
    const l = traceStepToLine(step({ type: 'tool_result', status: 'error', toolName: 'search', isError: true, toolOutput: 'boom' }));
    expect(l.error).toBe(true);
    expect(l.glyph).toBe('✗');
    expect(l.detail).toBe('boom');
  });

  it('treats pending/running as running (spinner), completed as not', () => {
    expect(traceStepToLine(step({ status: 'running' })).running).toBe(true);
    expect(traceStepToLine(step({ status: 'pending' })).running).toBe(true);
    expect(traceStepToLine(step({ status: 'completed' })).running).toBe(false);
  });

  it('gives friendly labels to thinking and text', () => {
    expect(traceStepToLine(step({ type: 'thinking' })).label).toBe('Réflexion');
    expect(traceStepToLine(step({ type: 'text' })).label).toBe('Réponse');
  });

  it('truncates a long detail to one line', () => {
    const long = 'a'.repeat(500);
    const l = traceStepToLine(step({ type: 'tool_result', toolOutput: long }));
    expect(l.detail!.length).toBeLessThanOrEqual(120);
    expect(l.detail!.endsWith('…')).toBe(true);
  });
});

describe('activityStatus', () => {
  it('is busy when a turn is active or a step is running', () => {
    expect(activityStatus([], { stepId: 's' }).busy).toBe(true);
    expect(activityStatus([step({ status: 'running' })], null).busy).toBe(true);
  });

  it('reports done / error / empty when idle', () => {
    expect(activityStatus([], null)).toEqual({ text: 'Rien pour l’instant', busy: false });
    expect(activityStatus([step({ status: 'completed' })], null)).toEqual({ text: 'Terminé', busy: false });
    expect(activityStatus([step({ status: 'error', isError: true })], null).text).toContain('erreur');
  });
});

describe('collectSessionDiffs', () => {
  const preview = (turnId: number, ...paths: Array<[string, number]>): DiffPreview => ({
    turnId,
    sessionId: 's',
    timestamp: turnId,
    status: 'pending',
    diffs: paths.map(([path, linesAdded]) => ({ path, action: 'modify', linesAdded, linesRemoved: 0, excerpt: '' })),
  });

  it('dedupes by path across previews, keeping the latest change', () => {
    const out = collectSessionDiffs([
      preview(1, ['a.ts', 1], ['b.ts', 2]),
      preview(2, ['a.ts', 9]), // a.ts changed again — latest (+9) wins
    ]);
    expect(out.map((d) => d.path)).toEqual(['a.ts', 'b.ts']);
    expect(out.find((d) => d.path === 'a.ts')!.linesAdded).toBe(9);
  });

  it('returns [] for undefined/empty', () => {
    expect(collectSessionDiffs(undefined)).toEqual([]);
    expect(collectSessionDiffs([])).toEqual([]);
  });
});
