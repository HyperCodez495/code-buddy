/**
 * @import Directive Parser (CC9)
 *
 * Scans markdown content for @path/to/file directives and resolves them
 * by reading the referenced files and injecting their content inline.
 *
 * Advanced enterprise architecture for @import support in CLAUDE.md files.
 *
 * Supported syntax:
 * - @path/to/file     — relative to the importing file's directory
 * - @~/path/to/file   — relative to home directory
 * - @//absolute/path  — absolute path
 *
 * Features:
 * - Recursive resolution (max 5 levels)
 * - Cycle detection via visited set
 * - Graceful failure (missing files become comments)
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

// ============================================================================
// Constants
// ============================================================================

/** Maximum recursion depth for nested imports */
const MAX_IMPORT_DEPTH = 5;

/** Maximum total content size after imports (chars) */
const MAX_IMPORT_CONTENT = 50_000;

/** Regex to match @import directives on their own line */
const IMPORT_DIRECTIVE_REGEX = /^@(~\/|\/\/|[^\s@].+?)$/gm;

// ============================================================================
// Types
// ============================================================================

export interface ImportResolveOptions {
  /** Directory of the importing file (for relative path resolution) */
  baseDir: string;
  /** Project root directory */
  projectRoot?: string;
  /** Home directory override (for testing) */
  homeDir?: string;
  /** Current recursion depth */
  depth?: number;
  /** Set of already-visited absolute paths (cycle detection) */
  visited?: Set<string>;
  /** Max recursion depth for nested imports (default 5) */
  maxDepth?: number;
  /** Max total content size after imports, in chars (default 50000) */
  maxBytes?: number;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Resolve all @import directives in the given content.
 *
 * Scans the content for lines matching `@path/to/file`, reads the
 * referenced file, recursively resolves its imports, and replaces
 * the directive line with the file content.
 *
 * @param content - Markdown content that may contain @import directives
 * @param options - Resolution options (baseDir required)
 * @returns Content with all imports resolved inline
 */
export function resolveImportDirectives(
  content: string,
  options: ImportResolveOptions,
): string {
  const {
    baseDir,
    projectRoot = process.cwd(),
    homeDir = process.env.HOME || process.env.USERPROFILE || '',
    depth = 0,
    visited = new Set<string>(),
    maxDepth = MAX_IMPORT_DEPTH,
    maxBytes = MAX_IMPORT_CONTENT,
  } = options;

  if (depth >= maxDepth) {
    logger.debug(`Import directive: max depth ${maxDepth} reached, skipping further imports`);
    return content;
  }

  let result = content;
  let totalSize = content.length;

  // Mask code regions so an @path directive that sits inside a fenced block or
  // inline code span is left as literal content, not resolved as an import.
  // Matches Claude Code / Gemini CLI semantics (a code example that mentions
  // `@./foo.md` must not trigger a file read).
  const codeRegions = findCodeRegions(content);

  result = result.replace(IMPORT_DIRECTIVE_REGEX, (fullMatch, importPath: string, offset: number) => {
    // Leave directives inside code spans/fences untouched.
    if (isInsideRegion(offset, codeRegions)) {
      return fullMatch;
    }
    // Resolve the import path
    const resolvedPath = resolveImportPath(importPath.trim(), baseDir, projectRoot, homeDir);

    if (!resolvedPath) {
      logger.debug(`Import directive: could not resolve "${importPath}"`);
      return `<!-- import not found: ${importPath} -->`;
    }

    // Cycle detection
    const absolutePath = path.resolve(resolvedPath);
    if (visited.has(absolutePath)) {
      logger.debug(`Import directive: cycle detected for "${importPath}"`);
      return `<!-- circular import: ${importPath} -->`;
    }

    // Check file exists
    if (!fs.existsSync(absolutePath)) {
      logger.debug(`Import directive: file not found "${absolutePath}"`);
      return `<!-- import not found: ${importPath} -->`;
    }

    try {
      let importedContent = fs.readFileSync(absolutePath, 'utf-8');

      // Size guard
      if (totalSize + importedContent.length > maxBytes) {
        logger.debug(`Import directive: size limit reached, truncating "${importPath}"`);
        const remaining = maxBytes - totalSize;
        if (remaining <= 0) {
          return `<!-- import truncated: ${importPath} -->`;
        }
        importedContent = importedContent.slice(0, remaining) + '\n... (truncated)';
      }

      // Mark as visited and recurse
      const newVisited = new Set(visited);
      newVisited.add(absolutePath);

      const resolved = resolveImportDirectives(importedContent, {
        baseDir: path.dirname(absolutePath),
        projectRoot,
        homeDir,
        depth: depth + 1,
        visited: newVisited,
        maxDepth,
        maxBytes,
      });

      totalSize += resolved.length;
      logger.debug(`Import directive: resolved "${importPath}" (${resolved.length} chars)`);
      return resolved;
    } catch (err) {
      logger.debug(`Import directive: read error for "${importPath}": ${err}`);
      return `<!-- import error: ${importPath} -->`;
    }
  });

  return result;
}

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Resolve an import path to an absolute file path.
 *
 * @param importPath - The path from the @import directive
 * @param baseDir - Directory of the importing file
 * @param projectRoot - Project root directory
 * @param homeDir - User home directory
 * @returns Resolved absolute path, or null if invalid
 */
function resolveImportPath(
  importPath: string,
  baseDir: string,
  projectRoot: string,
  homeDir: string,
): string | null {
  try {
    if (importPath.startsWith('~/')) {
      // Home-relative: @~/path/to/file
      return path.resolve(homeDir, importPath.slice(2));
    }

    if (importPath.startsWith('//')) {
      // Absolute path: @//absolute/path
      return path.resolve(importPath.slice(1));
    }

    // Relative to the importing file's directory
    return path.resolve(baseDir, importPath);
  } catch {
    return null;
  }
}

// ============================================================================
// Code-region masking (so @imports inside code are inert)
// ============================================================================

/**
 * Find all code spans/fences in the content as [start, end) ranges.
 *
 * Covers backtick code — inline `` `…` `` and fenced ```` ```…``` ```` (one or
 * more backticks, closed by the same count) — plus `~~~` fenced blocks. An
 * @import directive whose `@` falls inside any of these ranges is treated as
 * literal text. Mirrors the gemini-cli memory import processor.
 */
function findCodeRegions(content: string): Array<[number, number]> {
  const regions: Array<[number, number]> = [];

  // Backtick inline + fenced: one or more backticks, lazily to the same run.
  const backtick = /(`+)([\s\S]*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = backtick.exec(content)) !== null) {
    regions.push([m.index, m.index + m[0].length]);
  }

  // Tilde fenced blocks: a line of >=3 tildes, content, closing tilde line.
  const tilde = /^[^\S\n]*(~{3,})[^\n]*\n[\s\S]*?\n[^\S\n]*\1[^\S\n]*$/gm;
  while ((m = tilde.exec(content)) !== null) {
    regions.push([m.index, m.index + m[0].length]);
  }

  return regions;
}

/** True if `offset` lies within any [start, end) code region. */
function isInsideRegion(offset: number, regions: Array<[number, number]>): boolean {
  for (const [start, end] of regions) {
    if (offset >= start && offset < end) return true;
  }
  return false;
}
