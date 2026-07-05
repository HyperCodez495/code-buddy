export type OsStatusTone = 'ok' | 'warn' | 'error' | 'muted';

export interface OsStatusItem {
  label: string;
  value: string;
  tone?: OsStatusTone;
}

export interface NormalizedOsStatusItem {
  label: string;
  value: string;
  tone: OsStatusTone;
  rank: number;
}

const TONE_RANK = {
  error: 0,
  warn: 1,
  ok: 2,
  muted: 3,
};

export function normalizeStatusItem(item: OsStatusItem): NormalizedOsStatusItem {
  const tone = item.tone ?? 'muted';

  return {
    label: item.label.trim() || 'Statut',
    value: item.value.trim() || '—',
    tone,
    rank: TONE_RANK[tone],
  };
}

export function sortStatusItems(items: OsStatusItem[]): NormalizedOsStatusItem[] {
  return items
    .map(normalizeStatusItem)
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'fr'));
}

export function summarizeStatus(items: OsStatusItem[]) {
  const summary = { ok: 0, warn: 0, error: 0, muted: 0 };
  for (const item of sortStatusItems(items)) {
    summary[item.tone] += 1;
  }
  return summary;
}
