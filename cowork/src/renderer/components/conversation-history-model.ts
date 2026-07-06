/**
 * conversation-history-model — ChatGPT-style history grouping: pinned first,
 * then date buckets (Aujourd'hui / Hier / 7 jours / 30 jours / Plus ancien),
 * archived excluded, folded search. Pure + deterministic (`now` injected).
 */
import type { Session } from '../types';

export interface HistorySection {
  label: string;
  sessions: Session[];
}

const DAY = 24 * 60 * 60 * 1000;

function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function groupSessions(
  sessions: ReadonlyArray<Session>,
  query: string,
  now: number,
): HistorySection[] {
  const needle = query.trim() ? fold(query.trim()) : null;
  const visible = sessions
    .filter((s) => !s.archived)
    .filter((s) => !needle || fold(s.title ?? '').includes(needle))
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();

  const buckets: Array<{ label: string; test: (s: Session) => boolean }> = [
    { label: 'Épinglées', test: (s) => Boolean(s.pinned) },
    { label: "Aujourd'hui", test: (s) => s.updatedAt >= today },
    { label: 'Hier', test: (s) => s.updatedAt >= today - DAY },
    { label: '7 derniers jours', test: (s) => s.updatedAt >= today - 7 * DAY },
    { label: '30 derniers jours', test: (s) => s.updatedAt >= today - 30 * DAY },
    { label: 'Plus ancien', test: () => true },
  ];

  const sections: HistorySection[] = buckets.map(({ label }) => ({ label, sessions: [] }));
  for (const session of visible) {
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i]!.test(session)) {
        sections[i]!.sessions.push(session);
        break;
      }
    }
  }
  return sections.filter((section) => section.sessions.length > 0);
}
