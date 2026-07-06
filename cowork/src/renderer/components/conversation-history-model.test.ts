/**
 * conversation-history-model — ChatGPT-style grouping: pinned first, date
 * buckets, archived excluded, folded search.
 */
import { describe, expect, it } from 'vitest';
import { groupSessions } from './conversation-history-model.js';
import type { Session } from '../types';

const NOW = new Date('2026-07-06T15:00:00').getTime();
const DAY = 24 * 60 * 60 * 1000;

function s(id: string, agoMs: number, extra: Partial<Session> = {}): Session {
  return {
    id,
    title: `conv ${id}`,
    status: 'idle',
    createdAt: NOW - agoMs,
    updatedAt: NOW - agoMs,
    ...extra,
  } as Session;
}

describe('groupSessions', () => {
  it('buckets pinned first, then today / yesterday / 7d / 30d / older; archived excluded', () => {
    const sections = groupSessions(
      [
        s('today', 60_000),
        s('yesterday', DAY),
        s('week', 3 * DAY),
        s('month', 15 * DAY),
        s('old', 90 * DAY),
        s('pinned-old', 90 * DAY, { pinned: true }),
        s('archived', 60_000, { archived: true }),
      ],
      '',
      NOW,
    );
    expect(sections.map((x) => x.label)).toEqual([
      'Épinglées',
      "Aujourd'hui",
      'Hier',
      '7 derniers jours',
      '30 derniers jours',
      'Plus ancien',
    ]);
    expect(sections[0]!.sessions.map((x) => x.id)).toEqual(['pinned-old']);
    expect(sections[1]!.sessions.map((x) => x.id)).toEqual(['today']);
    expect(sections.flatMap((x) => x.sessions.map((y) => y.id))).not.toContain('archived');
  });

  it('search folds case and diacritics and drops empty sections', () => {
    const sections = groupSessions(
      [s('v', 60_000, { title: 'Crée une VIDÉO' }), s('x', 60_000, { title: 'autre' })],
      'video',
      NOW,
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]!.sessions.map((x) => x.id)).toEqual(['v']);
  });
});
