import { describe, expect, it } from 'vitest';

import { groupByDay, summarize, type CheckpointEntry } from './checkpoint-timeline-model';

const now = new Date(2026, 6, 6, 15, 30).getTime();

function checkpoint(id: string, createdAt: number, files: string[] = []): CheckpointEntry {
  return { id, label: `Checkpoint ${id}`, createdAt, files };
}

describe('checkpoint timeline model', () => {
  it('groups checkpoints into today, yesterday, and local date sections', () => {
    const twoDaysAgo = new Date(2026, 6, 4, 9, 0).getTime();

    const sections = groupByDay(
      [
        checkpoint('old', twoDaysAgo),
        checkpoint('yesterday', new Date(2026, 6, 5, 18, 0).getTime()),
        checkpoint('today', new Date(2026, 6, 6, 8, 0).getTime()),
      ],
      now,
    );

    expect(sections.map((section) => section.label)).toEqual([
      "Aujourd'hui",
      'Hier',
      new Date(twoDaysAgo).toLocaleDateString(),
    ]);
  });

  it('sorts entries by descending creation time inside each section', () => {
    const morning = new Date(2026, 6, 6, 8, 0).getTime();
    const afternoon = new Date(2026, 6, 6, 14, 0).getTime();

    const [today] = groupByDay([checkpoint('morning', morning), checkpoint('afternoon', afternoon)], now);

    expect(today?.entries.map((entry) => entry.id)).toEqual(['afternoon', 'morning']);
  });

  it('summarizes the number of files', () => {
    expect(summarize(checkpoint('none', now))).toBe('0 fichier');
    expect(summarize(checkpoint('one', now, ['src/index.ts']))).toBe('1 fichier');
    expect(summarize(checkpoint('many', now, ['a.ts', 'b.ts']))).toBe('2 fichiers');
  });
});
