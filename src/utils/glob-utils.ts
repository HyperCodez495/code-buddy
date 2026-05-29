/**
 * Shared Glob Utilities
 *
 * Extracted from rules-loader.ts for reuse across:
 * - CC10: instruction excludes
 * - CC9: import directive parser
 * - CC15: enhanced permission rules (gitignore syntax)
 *
 * Supports: **, *, ?, brace expansion {ts,tsx}, negation !pattern
 */

// ============================================================================
// Brace Expansion
// ============================================================================

/**
 * Expand brace patterns like {ts,tsx} into multiple patterns.
 * Only handles single-level (no nested braces).
 */
export function expandBraces(pattern: string): string[] {
  const match = pattern.match(/^(.*)\{([^}]+)\}(.*)$/);
  if (!match) return [pattern];

  const [, prefix = '', alternatives = '', suffix = ''] = match;
  return alternatives.split(',').map(alt => `${prefix}${alt.trim()}${suffix}`);
}

// ============================================================================
// Glob to Regex
// ============================================================================

/**
 * Convert a glob pattern to a RegExp.
 * Supports: **, *, ?, character classes [abc]
 */
export function globToRegex(glob: string): RegExp {
  let regex = '';
  let i = 0;
  while (i < glob.length) {
    const char = glob[i];
    if (char === undefined) break; // safe: loop condition i < glob.length guarantees this never fires; satisfies noUncheckedIndexedAccess
    if (char === '*' && glob[i + 1] === '*') {
      // ** matches any path segments
      regex += '.*';
      i += 2;
      // Skip following /
      if (glob[i] === '/') i++;
    } else if (char === '*') {
      // * matches anything except /
      regex += '[^/]*';
      i++;
    } else if (char === '?') {
      regex += '[^/]';
      i++;
    } else if ('.+^${}()|[]\\'.includes(char)) {
      regex += '\\' + char;
      i++;
    } else {
      regex += char;
      i++;
    }
  }
  return new RegExp('^' + regex + '$');
}

// ============================================================================
// Glob Matching
// ============================================================================

/**
 * Test if a file path matches a glob pattern.
 * Normalizes backslashes to forward slashes.
 */
export function matchGlob(filePath: string, pattern: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Handle brace expansion
  const expanded = expandBraces(normalizedPattern);
  return expanded.some(p => globToRegex(p).test(normalized));
}

/**
 * Test if a file path matches any of the given glob patterns.
 * Supports negation patterns prefixed with !
 *
 * Evaluation order: positive patterns checked first, then negation patterns
 * can exclude matches. A path must match at least one positive pattern and
 * not match any negation pattern.
 */
export function matchGlobPatterns(filePath: string, patterns: string[]): boolean {
  const positive = patterns.filter(p => !p.startsWith('!'));
  const negative = patterns.filter(p => p.startsWith('!')).map(p => p.slice(1));

  // Must match at least one positive pattern
  if (positive.length > 0 && !positive.some(p => matchGlob(filePath, p))) {
    return false;
  }

  // Must not match any negation pattern
  if (negative.some(p => matchGlob(filePath, p))) {
    return false;
  }

  return positive.length > 0;
}

// ============================================================================
// Path Resolution (for permission rules)
// ============================================================================

/**
 * Resolve a path pattern with special prefixes:
 * - `~/` → home directory
 * - `//` → absolute path (strip the leading /)
 * - `/` or no prefix → relative to project root
 */
export function resolvePathPattern(
  pattern: string,
  projectRoot: string,
  homeDir?: string,
): string {
  const home = homeDir || (process.env.HOME || process.env.USERPROFILE || '');

  if (pattern.startsWith('~/')) {
    return home.replace(/\\/g, '/') + pattern.slice(1);
  }
  if (pattern.startsWith('//')) {
    return pattern.slice(1); // //absolute/path → /absolute/path
  }
  if (pattern.startsWith('/')) {
    // Relative to project root
    return projectRoot.replace(/\\/g, '/') + pattern;
  }
  // No prefix — relative to project root
  return pattern;
}
