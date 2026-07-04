/**
 * TokenJuice — semantically-preserving input compression for large tool outputs.
 *
 * Inspired by OpenHuman's "TokenJuice" input layer, but scoped to only the tricks
 * that are genuinely ADDITIVE for Code Buddy (the rest is already covered by
 * `context-manager-v2`, `enhanced-compression`, `output-sanitizer`, `head-tail-truncation`
 * and the `lm-resizer` sidecar). Two lossless-in-meaning transforms:
 *
 *  1. `htmlToMarkdown` — convert RAW HTML to markdown, but ONLY when the input is
 *     genuinely raw HTML AND has not already been converted upstream (`looksLikeRawHtml`
 *     guards this). `web_fetch` already extracts text from HTML, so on its output this
 *     transform correctly no-ops — we never re-convert already-clean text/markdown.
 *  2. `dedupeRepeatedBlocks` — collapse EXACTLY-repeated consecutive lines/blocks
 *     (period 1..10 lines, ≥3 repeats) into one copy + a `(× N identique)` marker.
 *     Strictly exact duplicates — never fuzzy — so no unique information is lost.
 *
 * Every transform is a pure `(input) => { output, savedChars }`. `compress()` composes
 * the enabled ones. These NEVER truncate mid-string, so no CJK/emoji grapheme handling
 * is needed (deliberately out of scope — TokenJuice's grapheme logic only matters when
 * you cut on a byte/char boundary, which we never do here).
 *
 * @module context/token-juice
 */

export interface JuiceTransformResult {
  /** The transformed text (identity when nothing applied). */
  output: string;
  /** Chars removed vs input (0 when the transform did not fire). Never negative. */
  savedChars: number;
}

export interface JuiceOptions {
  /** Run htmlToMarkdown (guarded by looksLikeRawHtml). Default true. */
  html?: boolean;
  /** Run dedupeRepeatedBlocks. Default true. */
  dedupe?: boolean;
}

export interface JuiceResult extends JuiceTransformResult {
  /** Names of the transforms that actually changed the text. */
  applied: string[];
}

/** Below this length a tool output is left untouched (savings not worth the churn). */
export const JUICE_MIN_CHARS = 2000;

/** Consecutive-repeat detection bounds. */
const MAX_PERIOD = 10; // longest repeating block (in lines) we collapse
const MIN_REPEATS = 3; // need ≥3 identical copies before collapsing
const MIN_UNIT_TRIMMED_LEN = 4; // ignore trivial units (lone braces, commas) — avoids code corruption

/**
 * True when TokenJuice is enabled. Default ON (the transforms are lossless-in-meaning and
 * scoped to large verbose web output at the call site). Set `CODEBUDDY_TOKEN_JUICE` to
 * `false`/`0`/`off`/`no` for a hard kill-switch.
 */
export function isTokenJuiceEnabled(): boolean {
  const v = process.env.CODEBUDDY_TOKEN_JUICE;
  if (v === undefined) return true;
  const norm = v.trim().toLowerCase();
  return norm !== 'false' && norm !== '0' && norm !== 'off' && norm !== 'no';
}

// ============================================================================
// HTML → Markdown
// ============================================================================

/**
 * Heuristic: is `text` genuinely RAW HTML (not already-extracted text or markdown)?
 * Requires either a document-level tag or a real density of block/inline tags, so an
 * occasional `<tag>` inside prose or a markdown doc does NOT trip it.
 */
export function looksLikeRawHtml(text: string): boolean {
  if (!text || text.length < 32) return false;
  const head = text.slice(0, 4000).toLowerCase();
  if (/<!doctype html|<html[\s>]|<body[\s>]|<head[\s>]/.test(head)) return true;
  const tagMatches =
    text.match(/<\/?(?:div|p|span|a|table|tr|td|th|ul|ol|li|h[1-6]|script|style|br|img|section|article|nav|header|footer)\b/gi) || [];
  return tagMatches.length >= 5;
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&nbsp;': ' ', '&ndash;': '–', '&mdash;': '—', '&hellip;': '…', '&copy;': '©',
  '&reg;': '®', '&trade;': '™',
};

function decodeEntities(text: string): string {
  let out = text;
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    out = out.replace(new RegExp(entity, 'gi'), char);
  }
  out = out.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)));
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
  return out;
}

/**
 * Convert raw HTML to markdown — GUARDED: identity (savedChars 0) unless `looksLikeRawHtml`.
 * Preserves heading structure, link text+targets, lists and emphasis (more signal per token
 * than a flat tag-strip), while dropping non-content noise (script/style/head/nav/footer).
 */
export function htmlToMarkdown(input: string): JuiceTransformResult {
  if (!input || !looksLikeRawHtml(input)) return { output: input, savedChars: 0 };

  let md = input
    // Drop non-content elements entirely.
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Headings → markdown ATX (before generic block handling).
  md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_m, level: string, inner: string) => {
    const hashes = '#'.repeat(Number(level));
    return `\n\n${hashes} ${stripTags(inner).trim()}\n\n`;
  });

  // Links → [text](href). Drop empty/anchor-only links to their text.
  md = md.replace(/<a\b[^>]*?href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const text = stripTags(inner).trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return text;
    if (!text) return href;
    return `[${text}](${href})`;
  });

  // Emphasis.
  md = md
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_m, inner: string) => `**${stripTags(inner).trim()}**`)
    .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_m, inner: string) => `*${stripTags(inner).trim()}*`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => `\`${stripTags(inner).trim()}\``);

  // List items and block breaks.
  md = md
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/(?:div|section|article|ul|ol|tr)>/gi, '\n')
    .replace(/<\/(?:td|th)>/gi, ' | ');

  md = stripTags(md);
  md = decodeEntities(md);
  // Normalise whitespace: collapse runs of spaces/tabs and excess blank lines.
  md = md
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const savedChars = Math.max(0, input.length - md.length);
  return { output: md, savedChars };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

// ============================================================================
// Exact repeated-block deduplication
// ============================================================================

function unitIsSubstantial(unit: string[]): boolean {
  const joined = unit.join('\n');
  if (joined.trim().length < MIN_UNIT_TRIMMED_LEN) return false;
  return true;
}

/**
 * Collapse EXACTLY-repeated consecutive line-blocks (period 1..MAX_PERIOD lines, ≥MIN_REPEATS
 * copies) into a single copy followed by a `(× N identique)` marker. Only byte-exact duplicates
 * are collapsed — never fuzzy matches — so every unique line survives untouched. Classic win:
 * repetitive logs (same warning/stack printed hundreds of times).
 */
export function dedupeRepeatedBlocks(input: string): JuiceTransformResult {
  if (!input || input.indexOf('\n') === -1) return { output: input, savedChars: 0 };

  const lines = input.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    let collapsed = false;

    // Prefer the smallest period that yields a genuine repeat (max compression, correct for
    // both single-line runs and back-to-back multi-line blocks).
    for (let p = 1; p <= MAX_PERIOD && i + p * MIN_REPEATS <= lines.length; p++) {
      const unit = lines.slice(i, i + p);
      let reps = 1;
      while (blocksEqual(lines, i + reps * p, unit)) reps++;

      if (reps >= MIN_REPEATS && unitIsSubstantial(unit)) {
        out.push(...unit);
        out.push(`(× ${reps} identique)`);
        i += reps * p;
        collapsed = true;
        break;
      }
    }

    if (!collapsed) {
      out.push(lines[i] as string);
      i++;
    }
  }

  const output = out.join('\n');
  const savedChars = Math.max(0, input.length - output.length);
  // If nothing collapsed, return the exact original reference (identity).
  return savedChars > 0 ? { output, savedChars } : { output: input, savedChars: 0 };
}

/** True when the `unit.length` lines starting at `start` exactly equal `unit`. */
function blocksEqual(lines: string[], start: number, unit: string[]): boolean {
  if (start + unit.length > lines.length) return false;
  for (let k = 0; k < unit.length; k++) {
    if (lines[start + k] !== unit[k]) return false;
  }
  return true;
}

// ============================================================================
// Composition
// ============================================================================

/**
 * Compose the enabled TokenJuice transforms. Order: html→md first (structure recovery),
 * then dedupe (repeated-block collapse). Pure; returns the composed output, total chars
 * saved, and the names of transforms that actually fired.
 */
export function compress(input: string, opts: JuiceOptions = {}): JuiceResult {
  const runHtml = opts.html !== false;
  const runDedupe = opts.dedupe !== false;
  const applied: string[] = [];
  let text = input ?? '';

  if (runHtml) {
    const r = htmlToMarkdown(text);
    if (r.savedChars > 0) {
      text = r.output;
      applied.push('html→md');
    }
  }

  if (runDedupe) {
    const r = dedupeRepeatedBlocks(text);
    if (r.savedChars > 0) {
      text = r.output;
      applied.push('dedupe');
    }
  }

  const savedChars = Math.max(0, (input ?? '').length - text.length);
  return { output: text, savedChars, applied };
}
