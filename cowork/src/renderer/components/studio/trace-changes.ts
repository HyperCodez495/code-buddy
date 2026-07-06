/**
 * Derive the set of files the agent created/edited this session from its trace
 * steps (bolt.new shows the changed files). Pure + structurally typed.
 */
import type { StudioFileChange, ChangeKind } from '../studio-iterate/iterate-model.js';

export interface TraceLike {
  toolName?: string;
  toolInput?: Record<string, unknown> | undefined;
}

const ADD_TOOLS = new Set(['create_file', 'write_file', 'create', 'new_file']);
const EDIT_TOOLS = new Set(['str_replace', 'multi_edit', 'apply_patch', 'edit_file', 'edit', 'morph_edit']);
const DELETE_TOOLS = new Set(['delete_file', 'remove_file', 'rm']);
const PATH_KEYS = ['file_path', 'path', 'filename', 'target_file', 'file'];

function pathOf(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  for (const key of PATH_KEYS) {
    const v = input[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function toolKind(toolName: string): ChangeKind | null {
  if (ADD_TOOLS.has(toolName)) return 'added';
  if (EDIT_TOOLS.has(toolName)) return 'modified';
  if (DELETE_TOOLS.has(toolName)) return 'deleted';
  return null;
}

/**
 * One entry per touched path (dedup). Net kind: deleted if the last op deleted,
 * else added if it was ever created, else modified. Ordered by first touch.
 */
export function changedFilesFromTrace(steps: ReadonlyArray<TraceLike>): StudioFileChange[] {
  const order: string[] = [];
  const state = new Map<string, { added: boolean; deleted: boolean; touched: boolean }>();

  for (const step of steps) {
    const name = (step.toolName ?? '').toLowerCase();
    const kind = toolKind(name);
    if (!kind) continue;
    const path = pathOf(step.toolInput);
    if (!path) continue;
    if (!state.has(path)) {
      state.set(path, { added: false, deleted: false, touched: false });
      order.push(path);
    }
    const s = state.get(path)!;
    if (kind === 'added') s.added = true;
    if (kind === 'deleted') s.deleted = true;
    else s.deleted = false; // a write after a delete un-deletes it
    s.touched = true;
  }

  return order.map((path) => {
    const s = state.get(path)!;
    const kind: ChangeKind = s.deleted ? 'deleted' : s.added ? 'added' : 'modified';
    return { path, kind };
  });
}
