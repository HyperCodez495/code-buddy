/**
 * ```sheet block — the agent emits a machine-readable table in its reply
 * (same proven pattern as ```plan / ```deck): parsed here into SheetPreview's
 * props, hidden from the chat text. Pure + testable.
 */
import type { SheetCellValue } from './sheet-preview-model.js';

const SHEET_BLOCK_RE = /```sheet\s*\n([\s\S]*?)```/;

/** Keeps the preview + export sane — a Genspark-style sheet stays scannable. */
const MAX_ROWS = 500;
const MAX_COLUMNS = 30;

export interface ParsedSheet {
  title: string;
  columns: string[];
  rows: SheetCellValue[][];
}

function toCell(value: unknown): SheetCellValue {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

/** Parse a ```sheet fenced JSON block: {"title","columns":[…],"rows":[[…]]}. */
export function parseSheetBlock(text: string): ParsedSheet | null {
  const match = (text ?? '').match(SHEET_BLOCK_RE);
  if (!match) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(match[1]!);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const columns = Array.isArray(obj.columns)
    ? obj.columns
        .slice(0, MAX_COLUMNS)
        .map((c) => (typeof c === 'string' ? c.trim() : String(c)))
        .filter((c) => c.length > 0)
    : [];
  if (columns.length === 0) return null;

  const rows: SheetCellValue[][] = [];
  if (Array.isArray(obj.rows)) {
    for (const entry of obj.rows.slice(0, MAX_ROWS)) {
      if (!Array.isArray(entry)) continue;
      rows.push(entry.slice(0, columns.length).map(toCell));
    }
  }
  if (rows.length === 0) return null;

  return {
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim().slice(0, 80) : 'Feuille',
    columns,
    rows,
  };
}

/** Remove ```sheet blocks from the visible reply (the preview renders them). */
export function stripSheetBlocks(text: string): string {
  return text.replace(/```sheet\s*\n[\s\S]*?```/g, '').trim();
}

export interface SheetSourceMessage {
  role: string;
  content: ReadonlyArray<{ type: string; text?: string }>;
}

/** Most recent sheet in the session: streaming partial wins, else newest assistant. */
export function latestSheetBlock(messages: ReadonlyArray<SheetSourceMessage>, partial?: string): ParsedSheet | null {
  if (partial) {
    const live = parseSheetBlock(partial);
    if (live) return live;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    const text = m.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text ?? '')
      .join('');
    const sheet = parseSheetBlock(text);
    if (sheet) return sheet;
  }
  return null;
}

/** The generation prompt: emit the sheet block first, no tools. */
export function buildSheetGenerationPrompt(subject: string): string {
  return [
    `Construis une feuille de données sur : ${subject}`,
    '',
    'COMMENCE ta réponse par la feuille complète dans un bloc ```sheet (JSON strict) :',
    '```sheet',
    '{"title":"<titre>","columns":["<colonne>","<colonne>"],"rows":[["<valeur>",123]]}',
    '```',
    'Colonnes claires, 8 à 30 lignes de données CONCRÈTES (chiffres réels quand tu les connais,',
    "estimations marquées comme telles sinon), types cohérents par colonne (les nombres restent des nombres JSON).",
    "N'utilise AUCUN outil et n'écris AUCUN fichier — le bloc ```sheet suffit, l'interface le rend en aperçu.",
    'Après le bloc, résume la feuille en 2 phrases.',
  ].join('\n');
}

/** The export prompt: hand the emitted sheet to the real xlsx skill. */
export function buildSheetExportPrompt(sheet: ParsedSheet): string {
  return [
    `Exporte cette feuille en fichier Excel (.xlsx) avec le skill xlsx : crée « ${sheet.title}.xlsx »`,
    'dans le dossier de travail courant, en-têtes en gras, colonnes fidèles, types préservés',
    '(les nombres restent numériques). Réponds avec le chemin du fichier créé.',
    '',
    '```sheet',
    JSON.stringify({ title: sheet.title, columns: sheet.columns, rows: sheet.rows }, null, 1),
    '```',
  ].join('\n');
}
