/**
 * Media generation pure model — real tests (no mocks): aspect ratios, status
 * labels, grouping by status, and day bucketing against a fixed `now`.
 */
import { describe, expect, it } from 'vitest';
import {
  aspectRatio,
  statusLabel,
  groupByStatus,
  bucketByDay,
  type MediaGalleryItem,
} from '../../src/renderer/components/media-gen/media-model';

describe('aspectRatio', () => {
  it('maps known aspects and defaults to square', () => {
    expect(aspectRatio('16:9')).toEqual({ w: 16, h: 9 });
    expect(aspectRatio('9:16')).toEqual({ w: 9, h: 16 });
    expect(aspectRatio('1:1')).toEqual({ w: 1, h: 1 });
    expect(aspectRatio(undefined)).toEqual({ w: 1, h: 1 });
    expect(aspectRatio('weird')).toEqual({ w: 1, h: 1 });
  });
});

describe('statusLabel', () => {
  it('gives a French label per status', () => {
    expect(statusLabel('queued')).toBe('En file');
    expect(statusLabel('generating')).toBe('Génération');
    expect(statusLabel('done')).toBe('Terminé');
    expect(statusLabel('error')).toBe('Erreur');
  });
});

const now = 1_700_000_000_000;
const item = (id: string, status: MediaGalleryItem['status'], createdAt: number): MediaGalleryItem => ({
  id,
  type: 'image',
  status,
  prompt: id,
  createdAt,
});

describe('groupByStatus', () => {
  it('buckets items under their status with all keys present', () => {
    const groups = groupByStatus([
      item('a', 'done', now),
      item('b', 'done', now),
      item('c', 'queued', now),
    ]);
    expect(groups.done.map((i) => i.id)).toEqual(['a', 'b']);
    expect(groups.queued.map((i) => i.id)).toEqual(['c']);
    expect(groups.generating).toEqual([]);
    expect(groups.error).toEqual([]);
  });
});

describe('bucketByDay', () => {
  it('splits into today / yesterday / older relative to now', () => {
    const buckets = bucketByDay(
      [
        item('t', 'done', now - 3_600_000), // ~1h ago → today
        item('y', 'done', now - 26 * 3_600_000), // ~26h ago → yesterday
        item('o', 'done', now - 10 * 86_400_000), // 10d ago → older
      ],
      now,
    );
    expect(buckets.today.map((i) => i.id)).toContain('t');
    expect(buckets.older.map((i) => i.id)).toContain('o');
    expect(buckets.today).not.toContainEqual(expect.objectContaining({ id: 'o' }));
  });
});
