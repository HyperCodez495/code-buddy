/**
 * Pure schema helpers for AI sheet analyst surfaces.
 *
 * @module renderer/utils/sheet-schema
 */

export interface SheetSchema {
  title: string;
  source: string;
  columns: string[];
}

function hasAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function addColumn(columns: string[], column: string): void {
  if (!columns.includes(column)) columns.push(column);
}

function inferTitle(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'Table de recherche';
  return cleaned.length > 80 ? `${cleaned.slice(0, 77).trim()}...` : cleaned;
}

export function parseSheetRequest(prompt: string): SheetSchema {
  const normalized = prompt
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  const columns = ['Titre'];

  if (hasAny(normalized, ['vue', 'view'])) addColumn(columns, 'Vues');
  if (hasAny(normalized, ['like', 'jaime'])) addColumn(columns, 'Likes');
  if (hasAny(normalized, ['duree', 'duration'])) addColumn(columns, 'Durée');
  if (hasAny(normalized, ['date', 'publie', 'publication'])) addColumn(columns, 'Date');
  if (hasAny(normalized, ['auteur', 'chaine', 'channel', 'createur'])) addColumn(columns, 'Auteur');
  if (hasAny(normalized, ['prix', 'price', 'cout'])) addColumn(columns, 'Prix');
  if (hasAny(normalized, ['note', 'rating', 'score'])) addColumn(columns, 'Score');
  if (hasAny(normalized, ['url', 'lien', 'link', 'source'])) addColumn(columns, 'URL');
  if (columns.length === 1) {
    columns.push('Résumé', 'Source');
  }

  const source = hasAny(normalized, ['youtube', 'video', 'chaine'])
    ? 'YouTube / web'
    : hasAny(normalized, ['web', 'internet', 'source'])
      ? 'Web'
      : 'Recherche Code Buddy';

  return {
    title: inferTitle(prompt),
    source,
    columns,
  };
}

function escapeCsvField(field: string): string {
  if (/[",\r\n]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

export function rowsToCsv(schema: SheetSchema, rows: string[][]): string {
  const lines = [schema.columns.map(escapeCsvField).join(',')];
  for (const row of rows) {
    lines.push(schema.columns.map((_, index) => escapeCsvField(row[index] ?? '')).join(','));
  }
  return lines.join('\r\n');
}
