/**
 * File activity derivation — Phase A2 (Cowork↔Hermes parity)
 *
 * Hermes desktop tracks the agent's file I/O (reads/writes/edits) in
 * real time. Cowork already streams `TraceStep[]` per session into the
 * store, and tool calls that touch files are part of that stream. Rather
 * than add a new backend event, this helper *derives* a file-activity
 * timeline from the trace steps already present in the store.
 *
 * Contract:
 *   deriveFileActivity(steps: TraceStep[]): FileActivityEntry[]
 *
 *   - Considers only `type === 'tool_call'` steps with a recognised
 *     file tool name (see `FILE_TOOL_OPS`).
 *   - Failed/errored steps are *included* — a failed read still means the
 *     agent attempted to touch that file (deliberate choice).
 *   - Extracts the path from the tool input via a candidate-key list,
 *     with a best-effort `apply_patch` blob fallback.
 *   - Deduplicates per path: the most-recent op wins, with an occurrence
 *     `count`. Result is sorted by recency (newest first).
 *
 * @module renderer/utils/file-activity
 */

import type { TraceStep } from '../types';

export type FileActivityOp = 'read' | 'write' | 'edit';

export interface FileActivityEntry {
  /** Path as it appeared in the tool input (normalised to forward slashes). */
  path: string;
  /** Most recent operation observed for this path. */
  op: FileActivityOp;
  /** Tool name that produced the most recent operation. */
  tool: string;
  /** Timestamp (ms) of the most recent operation for this path. */
  at: number;
  /** How many recognised file operations touched this path. */
  count: number;
}

/**
 * Maps recognised file tool names (lower-cased) to the operation they
 * represent. Mirrors the alias set used by `src/main/security/rules-bridge.ts`
 * plus the patch-style editors. Tools not listed here are ignored.
 */
const FILE_TOOL_OPS: Record<string, FileActivityOp> = {
  // reads
  read: 'read',
  read_file: 'read',
  view_file: 'read',
  file_read: 'read',
  // writes (full-file create/overwrite)
  write: 'write',
  write_file: 'write',
  create: 'write',
  create_file: 'write',
  file_write: 'write',
  // edits (in-place mutation)
  edit: 'edit',
  str_replace: 'edit',
  str_replace_editor: 'edit',
  apply_patch: 'edit',
};

/** Candidate keys, in priority order, for a path-bearing string arg. */
const PATH_KEYS = ['path', 'file_path', 'filePath', 'filename', 'target_file'] as const;

/** Normalise Windows separators so dedup keys are stable cross-platform. */
function normalisePath(value: string): string {
  return value.replace(/\\/g, '/').trim();
}

/**
 * Pull a path out of an apply_patch-style blob. Codex/Code Buddy patch
 * envelopes carry `*** Update File: <path>` / `Add File` / `Delete File`
 * headers rather than a dedicated path arg. Best-effort: returns the first
 * header path, or null when the blob has no recognisable header.
 */
function extractPatchPath(input: Record<string, unknown>): string | null {
  const raw =
    (typeof input.patch === 'string' && input.patch) ||
    (typeof input.input === 'string' && input.input) ||
    (typeof input.content === 'string' && input.content) ||
    '';
  if (!raw) return null;
  const match = raw.match(/\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*(.+)/i);
  if (!match) return null;
  const captured = match[1];
  if (typeof captured !== 'string') return null;
  const path = captured.trim();
  return path ? normalisePath(path) : null;
}

/** Extract a usable file path from a tool-call input, or null. */
function extractPath(toolName: string, input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return normalisePath(value);
    }
  }
  // apply_patch (and any tool) may embed the path in a patch blob instead.
  if (toolName.toLowerCase() === 'apply_patch') {
    return extractPatchPath(input);
  }
  return null;
}

/**
 * Derive the per-session file activity timeline from raw trace steps.
 *
 * Steps are processed in order; the last op for a given path wins, and the
 * count accumulates across all recognised ops for that path. The returned
 * list is sorted by recency (newest `at` first).
 */
export function deriveFileActivity(steps: TraceStep[]): FileActivityEntry[] {
  const byPath = new Map<string, FileActivityEntry>();

  for (const step of steps) {
    if (step.type !== 'tool_call') continue;
    const toolName = step.toolName;
    if (!toolName) continue;
    const op = FILE_TOOL_OPS[toolName.toLowerCase()];
    if (!op) continue;

    const path = extractPath(toolName, step.toolInput);
    if (!path) continue;

    const existing = byPath.get(path);
    if (existing) {
      // Keep the latest op (steps arrive in chronological order, but guard
      // on timestamp so out-of-order replays still pick the freshest).
      const isNewer = step.timestamp >= existing.at;
      byPath.set(path, {
        path,
        op: isNewer ? op : existing.op,
        tool: isNewer ? toolName : existing.tool,
        at: isNewer ? step.timestamp : existing.at,
        count: existing.count + 1,
      });
    } else {
      byPath.set(path, { path, op, tool: toolName, at: step.timestamp, count: 1 });
    }
  }

  return Array.from(byPath.values()).sort((a, b) => b.at - a.at);
}

/** Group derived entries by operation, preserving recency order within each. */
export function groupFileActivityByOp(
  entries: FileActivityEntry[],
): Record<FileActivityOp, FileActivityEntry[]> {
  const groups: Record<FileActivityOp, FileActivityEntry[]> = {
    read: [],
    write: [],
    edit: [],
  };
  for (const entry of entries) {
    groups[entry.op].push(entry);
  }
  return groups;
}
