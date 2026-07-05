/**
 * Pure version helpers for AI Drive deliverables.
 *
 * @module renderer/utils/version-model
 */

export interface DeliverableVersion {
  id: string;
  label: string;
  createdAt: number;
  author: string;
  summary: string;
  entries: Record<string, string>;
}

export interface VersionDiffSummary {
  added: number;
  removed: number;
  changed: number;
}

export function diffSummary(a: DeliverableVersion, b: DeliverableVersion): VersionDiffSummary {
  const aKeys = new Set(Object.keys(a.entries));
  const bKeys = new Set(Object.keys(b.entries));
  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const key of bKeys) {
    if (!aKeys.has(key)) {
      added += 1;
    } else if (a.entries[key] !== b.entries[key]) {
      changed += 1;
    }
  }

  for (const key of aKeys) {
    if (!bKeys.has(key)) removed += 1;
  }

  return { added, removed, changed };
}
