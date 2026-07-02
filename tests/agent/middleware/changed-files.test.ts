/**
 * V3 — the quality gate must see the files a turn edited. Editors emit unified
 * diffs in their RESULTS, so the paths have to come from the editor tool CALLS.
 */
import { describe, it, expect } from 'vitest';
import { extractEditedFilesFromHistory } from '../../../src/agent/middleware/changed-files.js';
import type { ChatEntry } from '../../../src/agent/types.js';

function callEntry(name: string, args: unknown): ChatEntry {
  return {
    type: 'tool_call',
    content: '',
    timestamp: new Date(),
    toolCall: { id: 'c', type: 'function', function: { name, arguments: JSON.stringify(args) } },
  };
}

describe('extractEditedFilesFromHistory (V3)', () => {
  it('extracts the path from str_replace_editor / create_file calls', () => {
    const history: ChatEntry[] = [
      callEntry('str_replace_editor', { path: 'src/auth/login.ts', old_str: 'a', new_str: 'b' }),
      callEntry('create_file', { file_path: 'src/util/x.ts', content: '...' }),
    ];
    expect(extractEditedFilesFromHistory(history).sort()).toEqual(['src/auth/login.ts', 'src/util/x.ts']);
  });

  it('extracts paths from a multi_edit files[] array', () => {
    const history = [
      callEntry('multi_edit', { files: [{ path: 'a.ts' }, { file_path: 'b.ts' }, 'c.ts'] }),
    ];
    expect(extractEditedFilesFromHistory(history).sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('parses apply_patch unified-diff paths', () => {
    const patch = '--- a/src/server/api.ts\n+++ b/src/server/api.ts\n@@ -1 +1 @@\n-x\n+y\n';
    expect(extractEditedFilesFromHistory([callEntry('apply_patch', { patch })])).toEqual(['src/server/api.ts']);
  });

  it('parses Codex-style apply_patch envelopes and ignores /dev/null', () => {
    const patch = '*** Begin Patch\n*** Add File: src/new.ts\n+hello\n*** Update File: src/old.ts\n@@\n-a\n+b\n*** End Patch';
    expect(extractEditedFilesFromHistory([callEntry('apply_patch', { patch })]).sort()).toEqual(['src/new.ts', 'src/old.ts']);
  });

  it('ignores non-editor tools and malformed arguments', () => {
    const history: ChatEntry[] = [
      callEntry('bash', { command: 'ls' }),
      callEntry('read_file', { path: 'should-not-count.ts' }),
      { type: 'tool_call', content: '', timestamp: new Date(), toolCall: { id: 'c', type: 'function', function: { name: 'create_file', arguments: '{not json' } } },
    ];
    expect(extractEditedFilesFromHistory(history)).toEqual([]);
  });

  it('dedups a file edited across multiple calls', () => {
    const history = [
      callEntry('str_replace_editor', { path: 'src/a.ts', old_str: '1', new_str: '2' }),
      callEntry('str_replace_editor', { path: 'src/a.ts', old_str: '3', new_str: '4' }),
    ];
    expect(extractEditedFilesFromHistory(history)).toEqual(['src/a.ts']);
  });
});
