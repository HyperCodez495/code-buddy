/**
 * media-filter-model — pure filtering for the media library: by kind and by a
 * diacritic-folded text query matched against the media's prompt, model and
 * file name. Pure so it can be unit-tested without the renderer.
 */

export interface FilterableMedia {
  path: string;
  kind: 'image' | 'video' | 'audio';
  prompt?: string;
  model?: string;
}

export type MediaKindFilter = 'all' | 'image' | 'video' | 'audio';

function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function filterMedia<T extends FilterableMedia>(
  items: ReadonlyArray<T>,
  kind: MediaKindFilter,
  query: string,
): T[] {
  const needle = query.trim() ? fold(query.trim()) : null;
  return items.filter((item) => {
    if (kind !== 'all' && item.kind !== kind) return false;
    if (!needle) return true;
    const haystack = fold(`${item.prompt ?? ''} ${item.model ?? ''} ${basename(item.path)}`);
    return haystack.includes(needle);
  });
}
