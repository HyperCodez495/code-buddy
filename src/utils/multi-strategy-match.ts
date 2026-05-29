/**
 * Multi-Strategy Edit Matching
 *
 * Tries 4 matching strategies in cascade for str_replace operations:
 * 1. Exact — literal string match (fastest)
 * 2. Flexible — line-by-line with whitespace normalization
 * 3. Regex — tokenized pattern matching (handles reformatted code)
 * 4. Fuzzy — Levenshtein-based (most tolerant, slowest)
 *
 * Inspired by Gemini CLI's edit.ts cascade.
 */

import { logger } from './logger.js';

export interface MatchResult {
  /** The actual string from the source that matched */
  matched: string;
  /** Which strategy found the match */
  strategy: 'exact' | 'flexible' | 'regex' | 'fuzzy';
  /** Confidence score (0-1) */
  confidence: number;
}

// ============================================================================
// Strategy 1: Exact
// ============================================================================

function exactMatch(source: string, search: string): MatchResult | null {
  if (source.includes(search)) {
    return { matched: search, strategy: 'exact', confidence: 1.0 };
  }
  return null;
}

// ============================================================================
// Strategy 2: Flexible (whitespace-normalized line matching)
// ============================================================================

function flexibleMatch(source: string, search: string): MatchResult | null {
  const sourceLines = source.split('\n');
  const searchLines = search.split('\n');

  if (searchLines.length === 0) return null;

  const searchLinesStripped = searchLines.map(l => l.trim());

  // Slide a window of searchLines.length over sourceLines
  for (let i = 0; i <= sourceLines.length - searchLines.length; i++) {
    const window = sourceLines.slice(i, i + searchLines.length);
    const windowStripped = window.map(l => l.trim());

    const isMatch = windowStripped.every(
      (line, index) => line === searchLinesStripped[index],
    );

    if (isMatch) {
      // Return the original source lines (preserving indentation)
      const matched = sourceLines.slice(i, i + searchLines.length).join('\n');
      return { matched, strategy: 'flexible', confidence: 0.95 };
    }
  }

  return null;
}

// ============================================================================
// Strategy 3: Regex (tokenized pattern)
// ============================================================================

/**
 * Escape regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function regexMatch(source: string, search: string): MatchResult | null {
  // Split on common delimiters to get tokens
  const delimiters = /([():[\]{}<>=,;])/;
  const tokens = search.split(delimiters).filter(t => t.trim().length > 0);

  if (tokens.length < 2) return null; // Too few tokens for meaningful regex

  // Build a regex: escaped tokens joined by optional whitespace
  const escapedTokens = tokens.map(t => escapeRegex(t.trim()));
  const pattern = escapedTokens.join('\\s*');

  try {
    // Match line by line first, then try multiline
    const regex = new RegExp(pattern, 'm');
    const match = source.match(regex);

    if (match && match[0]) {
      return { matched: match[0], strategy: 'regex', confidence: 0.85 };
    }
  } catch {
    // Invalid regex — skip
  }

  return null;
}

// ============================================================================
// Strategy 3b: Unicode normalization (typographic → ASCII)
// ============================================================================

/**
 * Normalize Unicode typographic characters to ASCII equivalents.
 * LLMs often produce smart quotes, em-dashes, and other typographic chars.
 */
function normalizeUnicode(str: string): string {
  return str
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // smart single quotes → '
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // smart double quotes → "
    .replace(/[\u2013\u2014]/g, '-')               // en-dash/em-dash → -
    .replace(/\u2026/g, '...')                      // ellipsis → ...
    .replace(/[\u00A0]/g, ' ')                      // non-breaking space → space
    .replace(/[\u2002\u2003\u2009]/g, ' ')         // various Unicode spaces → space
    .replace(/[\uFF1A]/g, ':')                      // fullwidth colon
    .replace(/[\uFF08]/g, '(')                      // fullwidth parens
    .replace(/[\uFF09]/g, ')')
    .replace(/[\u2192]/g, '=>')                     // arrow → =>
    .replace(/[\u2260]/g, '!=');                    // not-equal → !=
}

function unicodeNormalizedMatch(source: string, search: string): MatchResult | null {
  const normalizedSearch = normalizeUnicode(search);
  const normalizedSource = normalizeUnicode(source);

  // Only try if normalization actually changed something
  if (normalizedSearch === search) return null;

  if (normalizedSource.includes(normalizedSearch)) {
    // Find the original source text corresponding to the normalized match
    const idx = normalizedSource.indexOf(normalizedSearch);
    // Map back to original — use a simple offset approach
    const matched = source.substring(idx, idx + normalizedSearch.length);
    return { matched, strategy: 'flexible', confidence: 0.92 };
  }

  return null;
}

// ============================================================================
// Strategy 4: Fuzzy (Levenshtein-based)
// ============================================================================

/**
 * Simple Levenshtein distance computation.
 * For large inputs, uses a banded approach to limit complexity.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Skip if too large (>50KB combined)
  if (m + n > 50000) return Math.abs(m - n);

  // Create matrix
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
  }
  const firstRow = dp[0] ?? [];
  if (dp[0] === undefined) dp[0] = firstRow;
  for (let j = 0; j <= n; j++) {
    firstRow[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    // Each row index 0..m was initialized above, so prevRow/curRow are defined.
    const prevRow = dp[i - 1] ?? [];
    const curRow = dp[i] ?? [];
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curRow[j] = prevRow[j - 1] ?? 0;
      } else {
        curRow[j] =
          1 + Math.min(prevRow[j] ?? 0, curRow[j - 1] ?? 0, prevRow[j - 1] ?? 0);
      }
    }
  }

  const lastRow = dp[m] ?? [];
  return lastRow[n] ?? 0;
}

const FUZZY_MATCH_THRESHOLD = 0.1; // 10% max difference
const WHITESPACE_PENALTY_FACTOR = 0.1;
const MIN_FUZZY_LENGTH = 10;

function fuzzyMatch(source: string, search: string): MatchResult | null {
  if (search.length < MIN_FUZZY_LENGTH) return null;

  const sourceLines = source.split('\n');
  const searchLines = search.split('\n');
  const searchBlock = search;

  // Complexity guard
  if (sourceLines.length * searchBlock.length * searchBlock.length > 400_000_000) {
    return null;
  }

  let bestScore = Infinity;
  let bestMatch = '';
  let bestStartLine = -1;

  // Slide a window of N lines (±2 lines tolerance)
  for (let winSize = Math.max(1, searchLines.length - 2); winSize <= searchLines.length + 2; winSize++) {
    for (let i = 0; i <= sourceLines.length - winSize; i++) {
      const window = sourceLines.slice(i, i + winSize).join('\n');

      // Length heuristic pre-filter
      const lengthDiff = Math.abs(window.length - searchBlock.length);
      if (lengthDiff / searchBlock.length > FUZZY_MATCH_THRESHOLD / WHITESPACE_PENALTY_FACTOR) {
        continue;
      }

      // Compute raw and whitespace-stripped distances
      const strippedWindow = window.replace(/\s/g, '');
      const strippedSearch = searchBlock.replace(/\s/g, '');
      const dNorm = levenshteinDistance(strippedWindow, strippedSearch);
      const dRaw = levenshteinDistance(window, searchBlock);

      // Weighted score: whitespace differences cost less
      const weightedDist = dNorm + (dRaw - dNorm) * WHITESPACE_PENALTY_FACTOR;
      const score = weightedDist / searchBlock.length;

      if (score < bestScore && score <= FUZZY_MATCH_THRESHOLD) {
        bestScore = score;
        bestMatch = window;
        bestStartLine = i;
      }
    }
  }

  if (bestMatch && bestStartLine >= 0) {
    return {
      matched: bestMatch,
      strategy: 'fuzzy',
      confidence: 1 - bestScore,
    };
  }

  return null;
}

// ============================================================================
// Public API: Cascade
// ============================================================================

/**
 * Try all matching strategies in cascade order.
 * Returns the first successful match, or null if none found.
 *
 * Cascade: exact → flexible → unicode → regex → fuzzy
 */
export function multiStrategyMatch(
  source: string,
  search: string,
): MatchResult | null {
  // 1. Exact
  const exact = exactMatch(source, search);
  if (exact) return exact;

  // 2. Flexible (whitespace-normalized lines)
  const flexible = flexibleMatch(source, search);
  if (flexible) {
    logger.debug(`Multi-strategy match: flexible match found (confidence ${flexible.confidence})`);
    return flexible;
  }

  // 3. Unicode normalization (typographic → ASCII)
  const unicode = unicodeNormalizedMatch(source, search);
  if (unicode) {
    logger.debug(`Multi-strategy match: unicode normalized match found (confidence ${unicode.confidence})`);
    return unicode;
  }

  // 4. Regex (tokenized)
  if (search.length >= 10) {
    const regex = regexMatch(source, search);
    if (regex) {
      logger.debug(`Multi-strategy match: regex match found (confidence ${regex.confidence})`);
      return regex;
    }
  }

  // 5. Fuzzy (Levenshtein)
  const fuzzy = fuzzyMatch(source, search);
  if (fuzzy) {
    logger.debug(`Multi-strategy match: fuzzy match found (confidence ${fuzzy.confidence})`);
    return fuzzy;
  }

  return null;
}
