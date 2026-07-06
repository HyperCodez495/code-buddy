/**
 * trace-changes — real test (no mocks): derive changed files from agent trace
 * steps (path extraction, add/edit/delete kinds, dedup, net kind).
 */
import { describe, expect, it } from 'vitest';
import { changedFilesFromTrace } from '../src/renderer/components/studio/trace-changes';

describe('changedFilesFromTrace', () => {
  it('maps write tools to added/modified/deleted with path extraction', () => {
    const changes = changedFilesFromTrace([
      { toolName: 'create_file', toolInput: { file_path: 'src/App.tsx' } },
      { toolName: 'str_replace', toolInput: { path: 'src/main.tsx' } },
      { toolName: 'delete_file', toolInput: { filename: 'old.css' } },
      { toolName: 'view_file', toolInput: { file_path: 'README.md' } }, // read → ignored
    ]);
    expect(changes).toEqual([
      { path: 'src/App.tsx', kind: 'added' },
      { path: 'src/main.tsx', kind: 'modified' },
      { path: 'old.css', kind: 'deleted' },
    ]);
  });

  it('dedups a path and keeps "added" when it was created then edited', () => {
    const changes = changedFilesFromTrace([
      { toolName: 'create_file', toolInput: { file_path: 'a.ts' } },
      { toolName: 'str_replace', toolInput: { file_path: 'a.ts' } },
      { toolName: 'multi_edit', toolInput: { file_path: 'a.ts' } },
    ]);
    expect(changes).toEqual([{ path: 'a.ts', kind: 'added' }]);
  });

  it('a write after a delete resurrects the file as modified/added', () => {
    const changes = changedFilesFromTrace([
      { toolName: 'delete_file', toolInput: { path: 'x.ts' } },
      { toolName: 'str_replace', toolInput: { path: 'x.ts' } },
    ]);
    expect(changes[0]!.kind).not.toBe('deleted');
  });

  it('ignores steps without a recognized tool or a path', () => {
    expect(changedFilesFromTrace([
      { toolName: 'search', toolInput: { query: 'foo' } },
      { toolName: 'create_file', toolInput: {} },
      { toolInput: { file_path: 'y.ts' } },
    ])).toEqual([]);
  });
});
