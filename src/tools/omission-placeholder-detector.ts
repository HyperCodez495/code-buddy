/**
 * Omission Placeholder Detector
 *
 * Detects when the LLM uses shorthand like "// rest of code..." or
 * "// ... existing methods" instead of providing real code content.
 * This prevents silent code deletion during file writes/edits.
 *
 * Inspired by Gemini CLI's omissionPlaceholderDetector.ts
 */

/** Recognized omission prefixes (before the "...") */
const OMITTED_PREFIXES = new Set([
  'rest of',
  'rest of method',
  'rest of methods',
  'rest of code',
  'rest of file',
  'rest of class',
  'rest of function',
  'rest of implementation',
  'remaining code',
  'remaining methods',
  'remaining implementation',
  'unchanged code',
  'unchanged method',
  'unchanged methods',
  'unchanged implementation',
  'existing code',
  'existing methods',
  'existing implementation',
  'other methods',
  'other code',
  'same as before',
  'previous code',
  'original code',
]);

/** Patterns that indicate truncated/omitted content */
const OMISSION_PATTERNS: RegExp[] = [
  // Single-line comments with ellipsis: // ... rest of code  /  // ... the rest of the code
  /\/\/\s*\.{2,}\s*(?:the\s+)?(rest|remaining|existing|unchanged|other|previous|original|same)\b/i,
  // Block comments: /* ... unchanged methods */
  /\/\*\s*\.{2,}\s*(?:the\s+)?(rest|remaining|existing|unchanged|other|previous|original|same)\b/i,
  // Hash comments (Python/Ruby/Shell): # ... rest of code
  /#\s*\.{2,}\s*(?:the\s+)?(rest|remaining|existing|unchanged|other|previous|original|same)\b/i,
  // Explicit truncation markers
  /\/\/\s*(TODO|FIXME|XXX)?\s*:?\s*(code|methods?|implementation|logic)\s*(omitted|removed|truncated|skipped)/i,
  // Parenthetical: (rest of code unchanged)
  /\(\s*(rest|remaining)\s+of\s+(code|methods?|implementation|file)\s*(unchanged|omitted|same)?\s*\)/i,
  // "... more methods/code here"
  /\.{2,}\s*(more|other|additional)\s+(methods?|code|functions?|implementation)\s*(here)?/i,
];

export interface OmissionDetectionResult {
  /** Whether omission placeholders were detected */
  hasOmissions: boolean;
  /** Lines containing omission placeholders (1-indexed) */
  lines: number[];
  /** The matched placeholder text for each detection */
  matches: string[];
}

/**
 * Normalize a single line and check for omission placeholders.
 * Returns the matched placeholder text if found, null otherwise.
 */
function normalizePlaceholder(line: string): string | null {
  const trimmed = line.trim();

  // Quick pre-filter: must contain "..." or "…" or at least ".."
  if (!trimmed.includes('..') && !trimmed.includes('…')) {
    // Also check pattern matches without ellipsis
    for (const pattern of OMISSION_PATTERNS) {
      if (pattern.test(trimmed)) return trimmed;
    }
    return null;
  }

  // Strip comment prefix
  let content = trimmed;
  if (content.startsWith('//')) content = content.slice(2);
  else if (content.startsWith('#')) content = content.slice(1);
  else if (content.startsWith('/*')) content = content.slice(2).replace(/\*\/$/, '');
  else if (content.startsWith('*')) content = content.slice(1);

  content = content.trim();

  // Strip surrounding parens
  if (content.startsWith('(') && content.endsWith(')')) {
    content = content.slice(1, -1).trim();
  }

  // Find ellipsis
  const ellipsisIdx = content.indexOf('...');
  const unicodeEllipsisIdx = content.indexOf('…');
  const idx = ellipsisIdx >= 0 ? ellipsisIdx : unicodeEllipsisIdx;

  if (idx < 0) {
    // No ellipsis — check full regex patterns
    for (const pattern of OMISSION_PATTERNS) {
      if (pattern.test(trimmed)) return trimmed;
    }
    return null;
  }

  // Extract prefix before ellipsis
  const prefix = content.slice(0, idx).trim().toLowerCase().replace(/\s+/g, ' ');

  // Check if prefix is a known omission phrase. Tolerate an interstitial "the"
  // ("rest of the code" ≡ "rest of code") — a very common LLM phrasing the raw set misses.
  const prefixNoThe = prefix.replace(/\bthe\b/g, '').replace(/\s+/g, ' ').trim();
  if (prefix.length > 0 && (OMITTED_PREFIXES.has(prefix) || OMITTED_PREFIXES.has(prefixNoThe))) {
    // Suffix after ellipsis should be empty, dots, or close-parens
    const suffix = content.slice(idx + 3).trim();
    if (suffix === '' || /^[.)}\]]*$/.test(suffix) || /^\.+$/.test(suffix)) {
      return trimmed;
    }
  }

  // Also check full line against regex patterns
  for (const pattern of OMISSION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(trimmed)) return trimmed;
  }

  return null;
}

/**
 * Detect omission placeholders in content.
 *
 * @param content - The new content being written
 * @param originalContent - Optional: the original content (to avoid false positives
 *   when the placeholder already existed in the original)
 * @returns Detection result with line numbers and matched text
 */
export function detectOmissionPlaceholders(
  content: string,
  originalContent?: string,
): OmissionDetectionResult {
  const lines: number[] = [];
  const matches: string[] = [];

  // Build set of original placeholder lines (to avoid false positives)
  const originalPlaceholders = new Set<string>();
  if (originalContent) {
    for (const line of originalContent.split('\n')) {
      const match = normalizePlaceholder(line);
      if (match) originalPlaceholders.add(line.trim());
    }
  }

  const contentLines = content.split('\n');
  for (const [i, line] of contentLines.entries()) {
    const match = normalizePlaceholder(line);

    if (match) {
      // Skip if the placeholder already existed in original
      if (originalPlaceholders.has(line.trim())) continue;

      lines.push(i + 1); // 1-indexed
      matches.push(match);
    }
  }

  return {
    hasOmissions: lines.length > 0,
    lines,
    matches,
  };
}

/**
 * Format a user-friendly error message for detected omissions.
 */
export function formatOmissionError(result: OmissionDetectionResult): string {
  if (!result.hasOmissions) return '';

  const examples = result.matches.slice(0, 3).map(m => `  "${m}"`).join('\n');
  const lineNums = result.lines.slice(0, 5).join(', ');

  return [
    `Omission placeholders detected on line(s) ${lineNums}.`,
    `Examples:`,
    examples,
    '',
    'Provide exact literal replacement text instead of placeholders like "rest of code..." or "unchanged methods...".',
    'Read the file first if you need to see the existing content.',
  ].join('\n');
}
