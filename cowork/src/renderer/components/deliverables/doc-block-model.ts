/**
 * ```doc block — the agent emits a machine-readable document in its reply
 * (same proven pattern as ```plan / ```deck / ```sheet): parsed here into
 * DocPreview's blocks, hidden from the chat text. Pure + testable.
 */
import type { DocBlockType, DocPreviewBlock } from './doc-preview-model.js';

const DOC_BLOCK_RE = /```doc\s*\n([\s\S]*?)```/;

/** Keeps the preview + export sane. */
const MAX_BLOCKS = 200;

const BLOCK_TYPES = new Set<DocBlockType>(['h1', 'h2', 'p', 'quote', 'code', 'list']);

export interface ParsedDoc {
  title: string;
  blocks: DocPreviewBlock[];
}

/** Parse a ```doc fenced JSON block: {"title","blocks":[{type,text,items}]}. */
export function parseDocBlock(text: string): ParsedDoc | null {
  const match = (text ?? '').match(DOC_BLOCK_RE);
  if (!match) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(match[1]!);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.blocks) || obj.blocks.length === 0) return null;

  const blocks: DocPreviewBlock[] = [];
  for (const entry of obj.blocks.slice(0, MAX_BLOCKS)) {
    if (!entry || typeof entry !== 'object') continue;
    const b = entry as Record<string, unknown>;
    const type = typeof b.type === 'string' && BLOCK_TYPES.has(b.type as DocBlockType) ? (b.type as DocBlockType) : null;
    if (!type) continue;
    const text = typeof b.text === 'string' && b.text.trim() ? b.text.trim() : undefined;
    const items = Array.isArray(b.items)
      ? b.items.filter((i): i is string => typeof i === 'string' && i.trim().length > 0)
      : [];
    if (!text && items.length === 0) continue;
    blocks.push({ type, ...(text ? { text } : {}), ...(items.length > 0 ? { items } : {}) });
  }
  if (blocks.length === 0) return null;

  const h1 = blocks.find((b) => b.type === 'h1')?.text;
  return {
    title:
      typeof obj.title === 'string' && obj.title.trim()
        ? obj.title.trim().slice(0, 80)
        : (h1 ?? 'Document').slice(0, 80),
    blocks,
  };
}

/** Remove ```doc blocks from the visible reply (the preview renders them). */
export function stripDocBlocks(text: string): string {
  return text.replace(/```doc\s*\n[\s\S]*?```/g, '').trim();
}

export interface DocSourceMessage {
  role: string;
  content: ReadonlyArray<{ type: string; text?: string }>;
}

/** Most recent doc in the session: streaming partial wins, else newest assistant. */
export function latestDocBlock(messages: ReadonlyArray<DocSourceMessage>, partial?: string): ParsedDoc | null {
  if (partial) {
    const live = parseDocBlock(partial);
    if (live) return live;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    const text = m.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text ?? '')
      .join('');
    const doc = parseDocBlock(text);
    if (doc) return doc;
  }
  return null;
}

/** The generation prompt: emit the doc block first, no tools. */
export function buildDocGenerationPrompt(subject: string): string {
  return [
    `Rédige un document structuré sur : ${subject}`,
    '',
    'COMMENCE ta réponse par le document complet dans un bloc ```doc (JSON strict) :',
    '```doc',
    '{"title":"<titre>","blocks":[{"type":"h1","text":"<titre>"},{"type":"p","text":"<paragraphe>"},{"type":"h2","text":"<section>"},{"type":"list","items":["<point>"]},{"type":"quote","text":"<citation>"}]}',
    '```',
    'Types autorisés : h1, h2, p, quote, code, list (items). Un seul h1, des sections h2 claires,',
    'des paragraphes CONCRETS (faits, chiffres, exemples — pas de remplissage).',
    "N'utilise AUCUN outil et n'écris AUCUN fichier — le bloc ```doc suffit, l'interface le rend en aperçu.",
    'Après le bloc, résume le document en 2 phrases.',
  ].join('\n');
}

/** The export prompt: hand the emitted doc to the real docx skill. */
export function buildDocExportPrompt(doc: ParsedDoc): string {
  return [
    `Exporte ce document en fichier Word (.docx) avec le skill docx : crée « ${doc.title}.docx »`,
    'dans le dossier de travail courant — h1 en Titre, h2 en Titre 2, listes à puces, citations en style',
    'Citation, blocs code en police monospace. Réponds avec le chemin du fichier créé.',
    '',
    '```doc',
    JSON.stringify({ title: doc.title, blocks: doc.blocks }, null, 1),
    '```',
  ].join('\n');
}
