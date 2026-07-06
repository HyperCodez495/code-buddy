/**
 * Pure model for multi-file editor tabs (bolt.new opens several files at once).
 * Immutable helpers — no React, no store.
 */
export interface EditorTab {
  path: string;
  dirty?: boolean;
}

export function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Open (or focus) a tab for `path`; returns a new array. */
export function openTab(tabs: readonly EditorTab[], path: string): EditorTab[] {
  if (!path) return [...tabs];
  if (tabs.some((t) => t.path === path)) return [...tabs];
  return [...tabs, { path }];
}

/** Close the tab for `path`; returns a new array. */
export function closeTab(tabs: readonly EditorTab[], path: string): EditorTab[] {
  return tabs.filter((t) => t.path !== path);
}

/**
 * The path to activate after closing `closing` when `active` was focused:
 * the neighbour to the right, else the left, else null. If a different tab was
 * active, it stays active.
 */
export function nextActiveAfterClose(
  tabs: readonly EditorTab[],
  closing: string,
  active: string | null,
): string | null {
  if (active !== closing) return active;
  const idx = tabs.findIndex((t) => t.path === closing);
  if (idx === -1) return active;
  const remaining = tabs.filter((t) => t.path !== closing);
  if (remaining.length === 0) return null;
  const next = remaining[idx] ?? remaining[idx - 1] ?? remaining[0];
  return next?.path ?? null;
}

/** Set the dirty flag on a tab; returns a new array. */
export function markDirty(tabs: readonly EditorTab[], path: string, dirty: boolean): EditorTab[] {
  return tabs.map((t) => (t.path === path ? { ...t, dirty } : t));
}
