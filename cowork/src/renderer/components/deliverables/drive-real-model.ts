/**
 * AI Drive on REAL files — map the workspace's recent files (the artifacts
 * IPC output) into DriveGrid items. Pure + testable.
 */
import type { DriveItem, DriveItemType } from '../../utils/drive-index.js';

export interface RecentFileEntry {
  path: string;
  modifiedAt: number;
  size: number;
}

const TYPE_BY_EXT: Record<string, DriveItemType> = {
  pptx: 'deck',
  ppt: 'deck',
  xlsx: 'sheet',
  xls: 'sheet',
  csv: 'sheet',
  docx: 'doc',
  doc: 'doc',
  md: 'report',
  pdf: 'report',
  html: 'page',
  htm: 'page',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  wav: 'podcast',
  ogg: 'podcast',
  mp3: 'podcast',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
};

/** File extensions the Drive surfaces (everything else is workspace noise). */
export function isDriveWorthy(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return ext in TYPE_BY_EXT;
}

/** Map one recent file into a DriveGrid item (null when not drive-worthy). */
export function toDriveItem(entry: RecentFileEntry): DriveItem | null {
  const name = entry.path.split('/').pop() ?? entry.path;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const type = TYPE_BY_EXT[ext];
  if (!type) return null;
  const parent = entry.path.split('/').slice(-2, -1)[0] ?? '';
  return {
    id: entry.path,
    title: name,
    type,
    tags: [ext, ...(parent && parent !== name ? [parent] : [])],
    updatedAt: entry.modifiedAt,
  };
}

/** Map + filter + newest-first. */
export function toDriveItems(entries: ReadonlyArray<RecentFileEntry>): DriveItem[] {
  return entries
    .map(toDriveItem)
    .filter((i): i is DriveItem => i !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
