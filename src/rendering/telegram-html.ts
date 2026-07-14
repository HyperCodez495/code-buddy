/**
 * Unified rendering — Telegram HTML.
 *
 * Renders a markdown string to Telegram's HTML subset (the robust parse mode:
 * inside text/<pre> only & < > need escaping, vs MarkdownV2's ~18 specials).
 * Output is ALWAYS valid HTML with balanced tags, split into ≤4096-char chunks
 * so a long reply never gets rejected. Unsupported markdown (headings, tables,
 * lists, hr) degrades to <b>/monospace/bullets rather than breaking.
 *
 * Supported Telegram tags: <b> <i> <u> <s> <code> <pre> <a href> <blockquote>.
 */
import { marked, type Token, type Tokens } from 'marked';
import { parseMarkdown, escapeHtml } from './markdown-core.js';

const TG_MAX = 4096;

// --- inline tokens → Telegram HTML ----------------------------------------

function renderInline(tokens: Token[] | undefined): string {
  if (!tokens) return '';
  let out = '';
  for (const t of tokens) {
    switch (t.type) {
      case 'text': {
        const tok = t as Tokens.Text;
        out += tok.tokens ? renderInline(tok.tokens) : escapeHtml(tok.text);
        break;
      }
      case 'escape':
        out += escapeHtml((t as Tokens.Escape).text);
        break;
      case 'strong':
        out += `<b>${renderInline((t as Tokens.Strong).tokens)}</b>`;
        break;
      case 'em':
        out += `<i>${renderInline((t as Tokens.Em).tokens)}</i>`;
        break;
      case 'del':
        out += `<s>${renderInline((t as Tokens.Del).tokens)}</s>`;
        break;
      case 'codespan':
        out += `<code>${escapeHtml((t as Tokens.Codespan).text)}</code>`;
        break;
      case 'br':
        out += '\n';
        break;
      case 'link': {
        const lnk = t as Tokens.Link;
        const inner = renderInline(lnk.tokens) || escapeHtml(lnk.text || '');
        // Only emit a link for safe http(s) hrefs; otherwise keep just the text.
        out += /^https?:\/\//i.test(lnk.href || '')
          ? `<a href="${escapeHtml(lnk.href)}">${inner}</a>`
          : inner;
        break;
      }
      case 'image':
        out += escapeHtml((t as Tokens.Image).text || (t as Tokens.Image).href || '');
        break;
      case 'html':
        // Raw inline HTML from the model is unsafe for Telegram → escape it literally.
        out += escapeHtml((t as Tokens.HTML).text);
        break;
      default: {
        const any = t as { tokens?: Token[]; text?: string; raw?: string };
        out += any.tokens ? renderInline(any.tokens) : escapeHtml(any.text ?? any.raw ?? '');
      }
    }
  }
  return out;
}

/** Inline tokens → plain text (no tags) — used inside <pre> table cells. */
function inlineToPlain(tokens: Token[] | undefined): string {
  if (!tokens) return '';
  let out = '';
  for (const t of tokens) {
    const any = t as { tokens?: Token[]; text?: string };
    out += any.tokens ? inlineToPlain(any.tokens) : (any.text ?? '');
  }
  return out;
}

/** Mobile Telegram <pre> wraps past ~40 monospace chars, which destroys column
 *  alignment — so only narrow tables get the aligned grid; wider ones become a
 *  vertical "record" layout (bold row title + `Header : value` lines). */
const TABLE_FIT_WIDTH = 40;

/** A markdown table → a complete Telegram-HTML block (aligned <pre> if it fits
 *  the mobile width, otherwise a responsive vertical layout). */
function renderTableBlock(t: Tokens.Table): string {
  const headers = t.header.map((c) => inlineToPlain(c.tokens).trim());
  const rows = t.rows.map((r) => r.map((c) => inlineToPlain(c.tokens).trim()));
  const cols = headers.length;
  const widths: number[] = [];
  for (let i = 0; i < cols; i++) {
    widths[i] = Math.max(headers[i]?.length ?? 0, ...rows.map((r) => (r[i] ?? '').length), 1);
  }
  const totalWidth = widths.reduce((a, b) => a + b, 0) + (cols - 1) * 2;
  const hasNewline = [...headers, ...rows.flat()].some((c) => c.includes('\n'));

  // Narrow + single-line → aligned monospace grid.
  if (totalWidth <= TABLE_FIT_WIDTH && !hasNewline) {
    const fmt = (cells: string[]) => cells.map((c, i) => (c ?? '').padEnd(widths[i]!)).join('  ').trimEnd();
    const sep = widths.map((w) => '─'.repeat(w)).join('  ');
    const text = [fmt(headers), sep, ...rows.map(fmt)].join('\n');
    return `<pre>${escapeHtml(text)}</pre>`;
  }

  // Wide → vertical records: first column is the bold row title, the rest are
  // `Header : value`. Reads cleanly at any screen width (no horizontal wrap).
  return rows
    .map((r) => {
      const lines = [`<b>${escapeHtml(r[0] ?? '')}</b>`];
      for (let i = 1; i < cols; i++) {
        if (r[i]) lines.push(`${escapeHtml(headers[i] ?? '')} : ${escapeHtml(r[i]!)}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

// --- block tokens → array of balanced-HTML fragments -----------------------

function renderBlocks(tokens: Token[]): string[] {
  const blocks: string[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'space':
        break;
      case 'heading':
        blocks.push(`<b>${renderInline((t as Tokens.Heading).tokens)}</b>`);
        break;
      case 'paragraph':
        blocks.push(renderInline((t as Tokens.Paragraph).tokens));
        break;
      case 'text': {
        const tok = t as Tokens.Text;
        blocks.push(tok.tokens ? renderInline(tok.tokens) : escapeHtml(tok.text));
        break;
      }
      case 'code':
        blocks.push(`<pre>${escapeHtml((t as Tokens.Code).text)}</pre>`);
        break;
      case 'table':
        blocks.push(renderTableBlock(t as Tokens.Table));
        break;
      case 'blockquote':
        blocks.push(`<blockquote>${renderBlocks((t as Tokens.Blockquote).tokens).join('\n')}</blockquote>`);
        break;
      case 'list': {
        const list = t as Tokens.List;
        const lines = list.items.map((it, i) => {
          const marker = list.ordered ? `${(Number(list.start) || 1) + i}. ` : '• ';
          const body = renderBlocks(it.tokens).join('\n');
          return marker + body.replace(/\n/g, '\n' + ' '.repeat(marker.length));
        });
        blocks.push(lines.join('\n'));
        break;
      }
      case 'hr':
        blocks.push('──────────');
        break;
      case 'html':
        blocks.push(escapeHtml((t as Tokens.HTML).text));
        break;
      default: {
        const any = t as { tokens?: Token[]; text?: string; raw?: string };
        blocks.push(any.tokens ? renderInline(any.tokens) : escapeHtml(any.text ?? any.raw ?? ''));
      }
    }
  }
  return blocks.filter((b) => b.trim().length > 0);
}

interface OpenTelegramTag {
  name: string;
  open: string;
  close: string;
}

const HTML_TOKEN = /<\/?[a-z]+(?:\s+[^>]*?)?>|&(?:#x?[0-9a-f]+|[a-z]+);|./gisu;

/**
 * Split one oversized rendered block without cutting an entity or leaving a
 * formatting tag open. Active tags are closed at the end of a chunk and
 * reopened in the next, so every Telegram message is independently valid.
 */
function splitBlock(block: string, maxLen: number): string[] {
  const out: string[] = [];
  let cur = '';
  let hasVisibleContent = false;
  const openTags: OpenTelegramTag[] = [];
  const closingTags = (): string => [...openTags].reverse().map((tag) => tag.close).join('');
  const reopenedTags = (): string => openTags.map((tag) => tag.open).join('');
  const flush = (): void => {
    if (!hasVisibleContent) return;
    out.push(cur + closingTags());
    cur = reopenedTags();
    hasVisibleContent = false;
  };

  for (const token of block.match(HTML_TOKEN) ?? []) {
    const closing = token.match(/^<\/([a-z]+)>$/i);
    if (closing) {
      const top = openTags.at(-1);
      if (top?.name === closing[1]!.toLowerCase()) {
        cur += token;
        openTags.pop();
      } else {
        cur += token;
      }
      continue;
    }

    const opening = token.match(/^<([a-z]+)(?:\s+[^>]*)?>$/i);
    if (opening) {
      const tag: OpenTelegramTag = {
        name: opening[1]!.toLowerCase(),
        open: token,
        close: `</${opening[1]!.toLowerCase()}>`,
      };
      if (cur.length + token.length + tag.close.length + closingTags().length > maxLen) {
        flush();
      }
      cur += token;
      openTags.push(tag);
      continue;
    }

    if (cur.length + token.length + closingTags().length > maxLen) flush();
    cur += token;
    hasVisibleContent = true;
  }
  flush();
  return out;
}

/**
 * Render markdown → array of Telegram-HTML message chunks (each ≤ maxLen,
 * each independently valid). Never throws: on any parse error it falls back to
 * escaped plain text.
 */
export function renderTelegramHtml(md: string, maxLen: number = TG_MAX): string[] {
  let blocks: string[];
  try {
    blocks = renderBlocks(parseMarkdown(md));
  } catch {
    blocks = (md ?? '').split('\n\n').map((b) => escapeHtml(b)).filter((b) => b.trim());
  }
  if (blocks.length === 0) return [];

  const chunks: string[] = [];
  let cur = '';
  const flush = () => { if (cur) { chunks.push(cur); cur = ''; } };
  for (const b of blocks) {
    if (b.length > maxLen) {
      flush();
      for (const sub of splitBlock(b, maxLen)) chunks.push(sub);
      continue;
    }
    if (cur.length + b.length + 2 > maxLen) flush();
    cur += (cur ? '\n\n' : '') + b;
  }
  flush();
  return chunks;
}

/**
 * Recover the text a person actually sees from one of our Telegram HTML
 * chunks. This is intentionally scoped to the small, trusted subset emitted by
 * `renderTelegramHtml`; it is used to preserve an already-delivered prefix
 * when a later chunk fails instead of claiming the full draft in continuity.
 */
export function telegramHtmlChunkToPlain(html: string): string {
  const withoutTags = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:blockquote|pre)>/gi, '\n')
    .replace(/<[^>]*>/g, '');

  return withoutTags
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (entity, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10);
      if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return entity;
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return entity;
      }
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

/** Re-export so the lexer used here is the only `marked` entry point. */
export { marked };
