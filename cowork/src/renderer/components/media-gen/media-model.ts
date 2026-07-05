export type MediaMode = 'image' | 'video';
export type MediaAspect = '1:1' | '16:9' | '9:16';
export type MediaStatus = 'queued' | 'generating' | 'done' | 'error';

export interface MediaGalleryItem {
  id: string;
  type: MediaMode;
  status: MediaStatus;
  url?: string;
  prompt: string;
  model?: string;
  aspect?: string;
  createdAt: number;
}

export interface AspectSize {
  w: number;
  h: number;
}

export type StatusGroups<T extends { status: MediaStatus }> = Record<MediaStatus, T[]>;
export type DayBucketKey = 'today' | 'yesterday' | 'older';
export type DayBuckets<T> = Record<DayBucketKey, T[]>;

const DAY_MS = 24 * 60 * 60 * 1000;

export function aspectRatio(aspect?: string): AspectSize {
  if (aspect === '16:9') return { w: 16, h: 9 };
  if (aspect === '9:16') return { w: 9, h: 16 };
  return { w: 1, h: 1 };
}

export function statusLabel(status: MediaStatus): string {
  if (status === 'queued') return 'En file';
  if (status === 'generating') return 'Génération';
  if (status === 'done') return 'Terminé';
  return 'Erreur';
}

export function groupByStatus<T extends { status: MediaStatus }>(items: readonly T[]): StatusGroups<T> {
  return items.reduce<StatusGroups<T>>(
    (groups, item) => {
      groups[item.status].push(item);
      return groups;
    },
    { queued: [], generating: [], done: [], error: [] },
  );
}

export function bucketByDay<T extends { createdAt: number }>(items: readonly T[], now = Date.now()): DayBuckets<T> {
  const startOfToday = startOfLocalDay(now);
  const startOfYesterday = startOfToday - DAY_MS;

  return items.reduce<DayBuckets<T>>(
    (buckets, item) => {
      if (item.createdAt >= startOfToday) {
        buckets.today.push(item);
      } else if (item.createdAt >= startOfYesterday) {
        buckets.yesterday.push(item);
      } else {
        buckets.older.push(item);
      }
      return buckets;
    },
    { today: [], yesterday: [], older: [] },
  );
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
