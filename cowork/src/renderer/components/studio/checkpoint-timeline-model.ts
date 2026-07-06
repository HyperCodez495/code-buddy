export interface CheckpointEntry {
  id: string;
  label: string;
  createdAt: number;
  files: string[];
}

export interface CheckpointDaySection {
  label: string;
  entries: CheckpointEntry[];
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function sectionLabel(timestamp: number, now: number): string {
  const day = startOfLocalDay(timestamp);
  const today = startOfLocalDay(now);
  const yesterday = today - 24 * 60 * 60 * 1000;

  if (day === today) return "Aujourd'hui";
  if (day === yesterday) return 'Hier';
  return new Date(timestamp).toLocaleDateString();
}

export function groupByDay(entries: readonly CheckpointEntry[], now: number): CheckpointDaySection[] {
  const sections = new Map<string, CheckpointEntry[]>();

  for (const entry of [...entries].sort((a, b) => b.createdAt - a.createdAt)) {
    const label = sectionLabel(entry.createdAt, now);
    const sectionEntries = sections.get(label) ?? [];
    sectionEntries.push(entry);
    sections.set(label, sectionEntries);
  }

  return [...sections.entries()].map(([label, sectionEntries]) => ({
    label,
    entries: sectionEntries,
  }));
}

export function summarize(entry: CheckpointEntry): string {
  const count = entry.files.length;
  return `${count} fichier${count > 1 ? 's' : ''}`;
}
