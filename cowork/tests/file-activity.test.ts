import { describe, expect, it } from 'vitest';
import {
  deriveFileActivity,
  groupFileActivityByOp,
  type FileActivityEntry,
} from '../src/renderer/utils/file-activity';
import type { TraceStep } from '../src/renderer/types';

let seq = 0;
function step(partial: Partial<TraceStep>): TraceStep {
  seq += 1;
  return {
    id: `step-${seq}`,
    type: 'tool_call',
    status: 'completed',
    title: partial.toolName ?? 'tool',
    timestamp: seq,
    ...partial,
  };
}

describe('deriveFileActivity', () => {
  it('recognises read / write / edit tools and extracts the path', () => {
    const steps: TraceStep[] = [
      step({ toolName: 'view_file', toolInput: { path: 'src/a.ts' }, timestamp: 10 }),
      step({ toolName: 'write_file', toolInput: { file_path: 'src/b.ts' }, timestamp: 20 }),
      step({ toolName: 'str_replace', toolInput: { file_path: 'src/c.ts' }, timestamp: 30 }),
    ];

    const entries = deriveFileActivity(steps);
    const byPath = new Map(entries.map((e) => [e.path, e]));

    expect(byPath.get('src/a.ts')?.op).toBe('read');
    expect(byPath.get('src/b.ts')?.op).toBe('write');
    expect(byPath.get('src/c.ts')?.op).toBe('edit');
  });

  it('extracts paths from the full candidate-key list', () => {
    const steps: TraceStep[] = [
      step({ toolName: 'read_file', toolInput: { filePath: 'src/camel.ts' } }),
      step({ toolName: 'read_file', toolInput: { filename: 'src/name.ts' } }),
      step({ toolName: 'edit', toolInput: { target_file: 'src/target.ts' } }),
    ];
    const paths = deriveFileActivity(steps).map((e) => e.path).sort();
    expect(paths).toEqual(['src/camel.ts', 'src/name.ts', 'src/target.ts']);
  });

  it('dedups per path keeping the latest op and counting occurrences', () => {
    const steps: TraceStep[] = [
      step({ toolName: 'view_file', toolInput: { path: 'src/x.ts' }, timestamp: 5 }),
      step({ toolName: 'str_replace', toolInput: { file_path: 'src/x.ts' }, timestamp: 15 }),
    ];
    const entries = deriveFileActivity(steps);
    expect(entries).toHaveLength(1);
    const entry = entries[0] as FileActivityEntry;
    expect(entry.op).toBe('edit'); // latest op wins
    expect(entry.tool).toBe('str_replace');
    expect(entry.at).toBe(15);
    expect(entry.count).toBe(2);
  });

  it('sorts by recency (newest first)', () => {
    const steps: TraceStep[] = [
      step({ toolName: 'view_file', toolInput: { path: 'old.ts' }, timestamp: 1 }),
      step({ toolName: 'view_file', toolInput: { path: 'new.ts' }, timestamp: 99 }),
    ];
    expect(deriveFileActivity(steps).map((e) => e.path)).toEqual(['new.ts', 'old.ts']);
  });

  it('extracts the path from an apply_patch blob header', () => {
    const steps: TraceStep[] = [
      step({
        toolName: 'apply_patch',
        toolInput: {
          patch: '*** Begin Patch\n*** Update File: src/patched.ts\n@@\n-old\n+new\n*** End Patch',
        },
      }),
    ];
    const entries = deriveFileActivity(steps);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe('src/patched.ts');
    expect(entries[0]?.op).toBe('edit');
  });

  it('normalises Windows separators so dedup is stable', () => {
    const steps: TraceStep[] = [
      step({ toolName: 'view_file', toolInput: { path: 'src\\win.ts' }, timestamp: 1 }),
      step({ toolName: 'edit', toolInput: { file_path: 'src/win.ts' }, timestamp: 2 }),
    ];
    const entries = deriveFileActivity(steps);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe('src/win.ts');
    expect(entries[0]?.count).toBe(2);
  });

  it('includes errored steps (a failed read still touched the file)', () => {
    const steps: TraceStep[] = [
      step({
        toolName: 'view_file',
        toolInput: { path: 'missing.ts' },
        status: 'error',
        isError: true,
      }),
    ];
    expect(deriveFileActivity(steps).map((e) => e.path)).toEqual(['missing.ts']);
  });

  it('ignores non-tool_call steps, unknown tools, and pathless inputs', () => {
    const steps: TraceStep[] = [
      step({ type: 'text', toolName: 'view_file', toolInput: { path: 'ignored.ts' } }),
      step({ toolName: 'bash', toolInput: { command: 'ls' } }),
      step({ toolName: 'view_file', toolInput: {} }),
      step({ toolName: 'view_file' }),
    ];
    expect(deriveFileActivity(steps)).toEqual([]);
  });
});

describe('groupFileActivityByOp', () => {
  it('buckets entries by op and preserves recency within each bucket', () => {
    const steps: TraceStep[] = [
      step({ toolName: 'view_file', toolInput: { path: 'r1.ts' }, timestamp: 1 }),
      step({ toolName: 'view_file', toolInput: { path: 'r2.ts' }, timestamp: 5 }),
      step({ toolName: 'write_file', toolInput: { path: 'w1.ts' }, timestamp: 3 }),
      step({ toolName: 'edit', toolInput: { path: 'e1.ts' }, timestamp: 4 }),
    ];
    const groups = groupFileActivityByOp(deriveFileActivity(steps));
    expect(groups.read.map((e) => e.path)).toEqual(['r2.ts', 'r1.ts']);
    expect(groups.write.map((e) => e.path)).toEqual(['w1.ts']);
    expect(groups.edit.map((e) => e.path)).toEqual(['e1.ts']);
  });
});
