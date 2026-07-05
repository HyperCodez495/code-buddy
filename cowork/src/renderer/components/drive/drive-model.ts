import { AppWindow, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Presentation, type LucideIcon } from 'lucide-react';

export type DriveItemKind = 'slide' | 'sheet' | 'doc' | 'image' | 'video' | 'report' | 'app' | 'audio';

export interface DriveItem {
  id: string;
  name: string;
  kind: DriveItemKind;
  createdAt: number;
  sizeBytes?: number;
  thumbnailUrl?: string;
}

export type DriveSort = 'recent' | 'name' | 'size';

export interface DriveFilterOptions {
  query?: string;
  kind?: string;
  sort?: DriveSort;
}

export interface DriveKindMeta {
  icon: LucideIcon;
  label: string;
  tint: 'default' | 'green' | 'amber' | 'red' | 'blue';
}

const KIND_META: Record<DriveItemKind, DriveKindMeta> = {
  slide: { icon: Presentation, label: 'Slides', tint: 'amber' },
  sheet: { icon: FileSpreadsheet, label: 'Feuilles', tint: 'green' },
  doc: { icon: FileText, label: 'Docs', tint: 'blue' },
  image: { icon: FileImage, label: 'Images', tint: 'green' },
  video: { icon: FileVideo, label: 'Vidéos', tint: 'red' },
  report: { icon: FileText, label: 'Rapports', tint: 'amber' },
  app: { icon: AppWindow, label: 'Apps', tint: 'blue' },
  audio: { icon: FileAudio, label: 'Audio', tint: 'default' },
};

export function kindMeta(kind: DriveItemKind): DriveKindMeta {
  return KIND_META[kind];
}

export function filterAndSortItems(items: DriveItem[], options: DriveFilterOptions): DriveItem[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? '';
  const kind = options.kind && options.kind !== 'all' ? options.kind : undefined;
  const sort = options.sort ?? 'recent';

  return items
    .filter((item) => (!query || item.name.toLocaleLowerCase().includes(query)) && (!kind || item.kind === kind))
    .slice().sort((a, b) => {
      if (sort === 'name') {
        return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }) || b.createdAt - a.createdAt;
      }
      if (sort === 'size') {
        return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) || b.createdAt - a.createdAt;
      }
      return b.createdAt - a.createdAt || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    });
}

export function humanSize(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }

  const units = ['o', 'Ko', 'Mo', 'Go'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${Math.round(value)} ${units[unitIndex]}`;
  }

  const formatted = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${formatted.replace(/\.0$/, '')} ${units[unitIndex]}`;
}

export function relativeTime(ts: number, now: number): string {
  if (!Number.isFinite(ts) || !Number.isFinite(now)) {
    return 'date inconnue';
  }

  const seconds = Math.max(0, Math.floor((now - ts) / 1000));
  if (seconds < 60) {
    return 'à l’instant';
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `il y a ${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `il y a ${hours} h`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `il y a ${days} j`;
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return `il y a ${months} mois`;
  }

  const years = Math.floor(months / 12);
  return `il y a ${years} an${years > 1 ? 's' : ''}`;
}
