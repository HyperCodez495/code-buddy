/**
 * Unified rendering — markdown core.
 *
 * Single source of truth for parsing markdown into a `marked` token AST. Every
 * surface renderer (Telegram HTML, ANSI terminal, plain text) consumes these
 * tokens so the SAME agent output renders consistently everywhere.
 */
import { marked, type Token, type TokensList } from 'marked';

/** Normalize then lex markdown into a `marked` token list. */
export function parseMarkdown(md: string): TokensList {
  const normalized = (md ?? '').replace(/\r\n/g, '\n');
  return marked.lexer(normalized);
}

export type { Token, TokensList };

/** HTML-escape the 3 characters that matter inside Telegram/HTML text + <pre>. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
