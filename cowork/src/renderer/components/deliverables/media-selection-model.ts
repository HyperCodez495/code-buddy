/**
 * media-selection-model — pure multi-selection helpers for the media library.
 */

export function toggle(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export function selectAll(ids: readonly string[]): Set<string> {
  return new Set(ids);
}

export function clear(): Set<string> {
  return new Set();
}

export function isAllSelected(selected: ReadonlySet<string>, ids: readonly string[]): boolean {
  return ids.length > 0 && ids.every((id) => selected.has(id));
}

export function selectionSummary(selected: ReadonlySet<string>, total: number): string {
  const count = selected.size;
  const label = count === 1 ? 'sélectionné' : 'sélectionnés';
  return `${count} / ${total} ${label}`;
}
