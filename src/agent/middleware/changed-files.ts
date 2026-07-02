/**
 * Derive the set of files a turn actually edited, from the editor tool CALLS in
 * history (their arguments carry the paths) rather than from tool RESULT text.
 *
 * Why: editor tools (str_replace_editor, create_file, multi_edit, apply_patch…)
 * emit unified DIFFS (`--- a/path`, `+++ b/path`, `@@`) in their results, so the
 * quality gate's old verb/`file:` scrape of result text never matched them and
 * saw an empty change set — the code-guardian reviewed nothing and the
 * security-review gate never became applicable (V3). The tool *call* arguments
 * are the authoritative, structured source of the paths.
 *
 * @module agent/middleware/changed-files
 */

import type { ChatEntry } from '../types.js';
import type { CodeBuddyToolCall } from '../../codebuddy/client.js';

/** Tools that write to the filesystem (+ their Codex-style aliases). */
const EDITOR_TOOLS = new Set([
  'str_replace_editor',
  'str_replace',
  'edit_file',
  'create_file',
  'write_file',
  'file_write',
  'multi_edit',
  'insert',
  'apply_patch',
]);

/** Argument keys that hold a single file path across the editor tools. */
const PATH_KEYS = ['path', 'file_path', 'filePath', 'file', 'target_file'];

function stripDiffPrefix(p: string): string {
  return p.replace(/^[ab]\//, '').trim();
}

/** Parse a unified/Codex patch body for the paths it touches. */
function parsePatchPaths(patch: string): string[] {
  const out = new Set<string>();
  for (const line of patch.split('\n')) {
    // Codex apply_patch envelope: *** Update File: path / Add File / Delete File
    const codex = line.match(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/);
    if (codex?.[1]) {
      out.add(codex[1].trim());
      continue;
    }
    // Unified diff headers
    const plus = line.match(/^\+\+\+\s+(.+)$/);
    if (plus?.[1]) {
      const p = stripDiffPrefix(plus[1]);
      if (p && p !== '/dev/null') out.add(p);
      continue;
    }
    const minus = line.match(/^---\s+(.+)$/);
    if (minus?.[1]) {
      const p = stripDiffPrefix(minus[1]);
      if (p && p !== '/dev/null') out.add(p);
    }
  }
  return Array.from(out);
}

function collectFromArgs(args: Record<string, unknown>, files: Set<string>): void {
  for (const k of PATH_KEYS) {
    const v = args[k];
    if (typeof v === 'string' && v.trim()) files.add(v.trim());
  }

  // A `files` array of strings or { path } objects (some multi-file editors).
  const filesArr = args.files;
  if (Array.isArray(filesArr)) {
    for (const f of filesArr) {
      if (typeof f === 'string' && f.trim()) {
        files.add(f.trim());
      } else if (f && typeof f === 'object') {
        collectFromArgs(f as Record<string, unknown>, files);
      }
    }
  }

  // apply_patch and friends carry the diff itself.
  for (const key of ['patch', 'diff', 'input']) {
    const patch = args[key];
    if (typeof patch === 'string' && patch.includes('\n')) {
      for (const p of parsePatchPaths(patch)) files.add(p);
    }
  }
}

/**
 * Scan chat history for editor tool calls and return the distinct file paths
 * they targeted. Never throws (malformed arguments are skipped).
 */
export function extractEditedFilesFromHistory(history: ChatEntry[]): string[] {
  const files = new Set<string>();

  for (const entry of history) {
    const calls: CodeBuddyToolCall[] = entry.toolCalls?.length
      ? entry.toolCalls
      : entry.toolCall
        ? [entry.toolCall]
        : [];

    for (const c of calls) {
      const name = c?.function?.name;
      if (!name || !EDITOR_TOOLS.has(name)) continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(c.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        continue; // unparseable arguments — skip this call
      }
      collectFromArgs(args, files);
    }
  }

  return Array.from(files);
}
