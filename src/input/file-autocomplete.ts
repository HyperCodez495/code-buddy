/**
 * @-file Autocomplete
 *
 * Provides file path completion for @-references in user input,
 * supporting line range syntax and .gitignore filtering.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

export interface FileCompletion {
  path: string;
  display: string;
  isDirectory: boolean;
  lineRange?: string;
}

export interface AtReference {
  path: string;
  lineStart?: number;
  lineEnd?: number;
}

const MAX_RESULTS = 20;

/**
 * FileAutocomplete provides completion suggestions for @-file references.
 */
export class FileAutocomplete {
  private gitignorePatterns: string[] = [];

  /**
   * Parse a .gitignore file and extract patterns.
   */
  private loadGitignore(workDir: string): void {
    this.gitignorePatterns = [];
    const gitignorePath = path.join(workDir, '.gitignore');
    try {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      this.gitignorePatterns = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    } catch {
      // No .gitignore or unreadable
    }
  }

  /**
   * Check if a relative path matches any gitignore pattern.
   */
  private isIgnored(relativePath: string): boolean {
    for (const pattern of this.gitignorePatterns) {
      const cleanPattern = pattern.replace(/\/$/, '');
      // Simple matching: exact name match or directory prefix
      const basename = path.basename(relativePath);
      if (basename === cleanPattern) return true;
      if (relativePath.startsWith(cleanPattern + '/')) return true;
      if (relativePath === cleanPattern) return true;
      // Glob-style: pattern with * (simple wildcard)
      if (cleanPattern.includes('*')) {
        const regex = new RegExp(
          '^' + cleanPattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
        );
        if (regex.test(basename) || regex.test(relativePath)) return true;
      }
    }
    return false;
  }

  /**
   * Complete a partial path, returning matching files and directories.
   */
  complete(partial: string, workDir: string): FileCompletion[] {
    this.loadGitignore(workDir);

    // Strip line range suffix for path matching
    const colonIdx = partial.indexOf(':');
    let pathPart = partial;
    let lineRange: string | undefined;
    if (colonIdx !== -1) {
      pathPart = partial.slice(0, colonIdx);
      lineRange = partial.slice(colonIdx + 1);
    }

    const fullPath = path.resolve(workDir, pathPart);
    const results: FileCompletion[] = [];

    // Determine directory to scan and prefix to match
    let dirToScan: string;
    let prefix: string;

    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        dirToScan = fullPath;
        prefix = '';
      } else {
        dirToScan = path.dirname(fullPath);
        prefix = path.basename(fullPath);
      }
    } catch {
      dirToScan = path.dirname(fullPath);
      prefix = path.basename(fullPath);
    }

    try {
      const entries = fs.readdirSync(dirToScan, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) break;

        if (prefix && !entry.name.startsWith(prefix)) continue;

        const entryRelative = path.relative(workDir, path.join(dirToScan, entry.name));
        if (this.isIgnored(entryRelative)) continue;

        const isDir = entry.isDirectory();
        const displayPath = entryRelative + (isDir ? '/' : '');

        results.push({
          path: entryRelative,
          display: displayPath + (lineRange ? ':' + lineRange : ''),
          isDirectory: isDir,
          lineRange,
        });
      }
    } catch {
      logger.debug(`[FileAutocomplete] Cannot read directory: ${dirToScan}`);
    }

    return results;
  }

  /**
   * Parse an @-reference string into a path and optional line range.
   * Returns null if the input is not a valid @-reference.
   */
  parseAtReference(input: string): AtReference | null {
    if (!input || !input.startsWith('@')) {
      return null;
    }

    const ref = input.slice(1); // Remove @
    if (!ref) return null;

    const colonIdx = ref.indexOf(':');
    if (colonIdx === -1) {
      return { path: ref };
    }

    const filePath = ref.slice(0, colonIdx);
    const rangeStr = ref.slice(colonIdx + 1);

    if (!filePath) return null;

    const rangeMatch = rangeStr.match(/^(\d+)(?:-(\d+))?$/);
    const startCapture = rangeMatch?.[1];
    if (!rangeMatch || startCapture === undefined) {
      // Colon but no valid range - still return path
      return { path: filePath };
    }

    const lineStart = parseInt(startCapture, 10);
    const endCapture = rangeMatch[2];
    const lineEnd = endCapture ? parseInt(endCapture, 10) : undefined;

    return { path: filePath, lineStart, lineEnd };
  }
}

// Singleton
let instance: FileAutocomplete | null = null;

export function getFileAutocomplete(): FileAutocomplete {
  if (!instance) {
    instance = new FileAutocomplete();
  }
  return instance;
}

export function resetFileAutocomplete(): void {
  instance = null;
}
