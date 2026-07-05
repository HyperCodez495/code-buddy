/**
 * AI Drive pure model — real tests (no mocks): filtering/sorting, human sizes and
 * relative times on fixed inputs.
 */
import { describe, expect, it } from 'vitest';
import {
  filterAndSortItems,
  humanSize,
  relativeTime,
  kindMeta,
  type DriveItem,
} from '../../src/renderer/components/drive/drive-model';

const now = 1_700_000_000_000;

const items: DriveItem[] = [
  { id: 'a', name: 'Zeta report', kind: 'report', createdAt: now - 10_000, sizeBytes: 2_000_000 },
  { id: 'b', name: 'Alpha deck', kind: 'slide', createdAt: now - 5_000, sizeBytes: 500_000 },
  { id: 'c', name: 'photo.png', kind: 'image', createdAt: now - 20_000, sizeBytes: 3_000_000 },
];

describe('filterAndSortItems', () => {
  it('sorts by recent by default (newest first)', () => {
    const out = filterAndSortItems(items, { sort: 'recent' });
    expect(out.map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by name (case/accent-insensitive) and by size', () => {
    expect(filterAndSortItems(items, { sort: 'name' }).map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(filterAndSortItems(items, { sort: 'size' }).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('filters by query (name substring, case-insensitive) and by kind', () => {
    expect(filterAndSortItems(items, { query: 'alpha' }).map((i) => i.id)).toEqual(['b']);
    expect(filterAndSortItems(items, { kind: 'image' }).map((i) => i.id)).toEqual(['c']);
    expect(filterAndSortItems(items, { kind: 'all' })).toHaveLength(3);
  });

  it('does not mutate the input array', () => {
    const before = items.map((i) => i.id);
    filterAndSortItems(items, { sort: 'name' });
    expect(items.map((i) => i.id)).toEqual(before);
  });
});

describe('humanSize', () => {
  it('formats bytes across units and handles missing/invalid', () => {
    expect(humanSize(0)).toBe('0 o');
    expect(humanSize(512)).toBe('512 o');
    expect(humanSize(2048)).toBe('2 Ko');
    expect(humanSize(5_242_880)).toBe('5 Mo');
    expect(humanSize(undefined)).toBe('—');
    expect(humanSize(-1)).toBe('—');
  });
});

describe('relativeTime', () => {
  it('bins into instant / minutes / hours / days', () => {
    expect(relativeTime(now - 5_000, now)).toBe('à l’instant');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('il y a 5 min');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('il y a 3 h');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('il y a 2 j');
    expect(relativeTime(Number.NaN, now)).toBe('date inconnue');
  });
});

describe('kindMeta', () => {
  it('returns a label + icon + tint for every kind', () => {
    for (const kind of ['slide', 'sheet', 'doc', 'image', 'video', 'report', 'app', 'audio'] as const) {
      const meta = kindMeta(kind);
      expect(meta.label).toBeTruthy();
      expect(meta.icon).toBeTruthy();
      expect(meta.tint).toBeTruthy();
    }
  });
});
