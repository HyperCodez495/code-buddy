/**
 * Pure helpers for the Knowledge panel (new-shell Labs) — the read-only view onto the Collective
 * Knowledge Graph (CKG). Kept pure + unit-tested; the panel is a thin renderer, the data comes from
 * the core CKG via the `knowledge.*` IPC. Ingested research papers/code insights are type
 * `'discovery'`; the CKG also holds lessons/decisions/facts from the agent collective.
 */

/** Mirror of the core CKG `listEntities` row (renderer can't import core types directly). */
export interface KnowledgeEntity {
  id: string;
  name: string;
  type: string;
  source?: string;
  confidence: number;
  mentions: number;
  contributors: number;
  createdAt: string;
}

export interface KnowledgeStats {
  entities: number;
  superseded: number;
  relations: number;
  ledgerPath: string;
}

export interface TypeGroup {
  type: string;
  entities: KnowledgeEntity[];
}

/** Human labels for the CKG entity vocabulary — discoveries first (the research corpus). */
const TYPE_ORDER = ['discovery', 'lesson', 'decision', 'fact', 'task', 'concept', 'agent'];

export function typeLabel(type: string): string {
  switch (type) {
    case 'discovery':
      return 'Découvertes (recherche)';
    case 'lesson':
      return 'Leçons';
    case 'decision':
      return 'Décisions';
    case 'fact':
      return 'Faits';
    case 'task':
      return 'Tâches';
    case 'concept':
      return 'Concepts';
    case 'agent':
      return 'Agents';
    default:
      return type;
  }
}

/**
 * Group entities by type, most useful types first (discoveries lead), unknown types after in
 * alphabetical order. Within a group, newest first (the IPC already returns newest-first, but we
 * re-sort defensively so the panel never depends on server order).
 */
export function groupByType(entities: readonly KnowledgeEntity[]): TypeGroup[] {
  const byType = new Map<string, KnowledgeEntity[]>();
  for (const e of entities) {
    const bucket = byType.get(e.type) ?? [];
    bucket.push(e);
    byType.set(e.type, bucket);
  }
  const rank = (t: string): number => {
    const i = TYPE_ORDER.indexOf(t);
    return i === -1 ? TYPE_ORDER.length : i;
  };
  return [...byType.entries()]
    .sort((a, b) => {
      const ra = rank(a[0]);
      const rb = rank(b[0]);
      return ra !== rb ? ra - rb : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    })
    .map(([type, es]) => ({
      type,
      entities: [...es].sort((x, y) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0)),
    }));
}

/** Confidence as a 0–100 integer percentage (CKG confidence is a 0–1 corroboration score). */
export function confidencePct(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(100, Math.round(confidence * 100)));
}

/** Short YYYY-MM-DD from an ISO timestamp; empty string if unparseable (never throws). */
export function shortDate(iso: string): string {
  if (typeof iso !== 'string' || iso.length < 10) return '';
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

/** Normalize a user-entered topic (trim); returns null if empty so callers can skip no-op adds. */
export function normalizeTopic(raw: string): string | null {
  const t = (raw ?? '').trim();
  return t.length > 0 ? t : null;
}
