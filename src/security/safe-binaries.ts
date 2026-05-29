/**
 * Safe Binaries System
 *
 * Maintains a list of commands that are safe to execute without
 * user approval. These are read-only or informational commands
 * that cannot modify the filesystem or system state.
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Safe Binaries List
// ============================================================================

export const SAFE_BINARIES: readonly string[] = [
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find',
  'which', 'whoami', 'pwd', 'echo', 'date', 'uname', 'hostname',
  'env', 'printenv', 'file', 'stat', 'du', 'df', 'free', 'uptime',
  'id', 'groups', 'locale', 'tty', 'stty', 'basename', 'dirname',
  'realpath', 'readlink', 'md5sum', 'sha256sum', 'sort', 'uniq',
  'tr', 'cut', 'paste', 'diff', 'comm', 'tee', 'xargs', 'seq',
  'yes', 'true', 'false', 'test', 'expr',
] as const;

// ============================================================================
// SafeBinariesChecker
// ============================================================================

export class SafeBinariesChecker {
  private static instance: SafeBinariesChecker | null = null;

  private safeBinaries: Set<string>;
  private customized = false;

  private constructor() {
    this.safeBinaries = new Set(SAFE_BINARIES);
  }

  static getInstance(): SafeBinariesChecker {
    if (!SafeBinariesChecker.instance) {
      SafeBinariesChecker.instance = new SafeBinariesChecker();
    }
    return SafeBinariesChecker.instance;
  }

  static resetInstance(): void {
    SafeBinariesChecker.instance = null;
  }

  isSafe(command: string): boolean {
    const trimmed = command.trim();
    if (!trimmed) return false;

    const firstWord = this.extractFirstWord(trimmed);
    return this.safeBinaries.has(firstWord);
  }

  isSafeChain(command: string): boolean {
    const trimmed = command.trim();
    if (!trimmed) return false;

    // Split on pipes, &&, ||, and ;
    const parts = trimmed.split(/\s*(?:\|{1,2}|&&|;)\s*/);

    for (const part of parts) {
      const cleaned = part.trim();
      if (!cleaned) continue;
      if (!this.isSafe(cleaned)) {
        return false;
      }
    }

    return true;
  }

  getSafeBinaries(): string[] {
    return Array.from(this.safeBinaries).sort();
  }

  addSafeBinary(name: string): void {
    this.safeBinaries.add(name);
    this.customized = true;
    logger.debug('Added safe binary', { name });
  }

  removeSafeBinary(name: string): void {
    this.safeBinaries.delete(name);
    this.customized = true;
    logger.debug('Removed safe binary', { name });
  }

  isCustomized(): boolean {
    return this.customized;
  }

  private extractFirstWord(command: string): string {
    // Handle env var prefixes like FOO=bar cmd
    let cmd = command;
    while (/^\w+=\S*\s+/.test(cmd)) {
      cmd = cmd.replace(/^\w+=\S*\s+/, '');
    }

    // Handle sudo/command prefixes
    const prefixes = ['sudo', 'command', 'builtin'];
    const parts = cmd.split(/\s+/);
    // String.split always returns at least one element, so parts[0] is defined;
    // fall back to '' to satisfy the type checker without changing behavior.
    let firstWord = parts[0] ?? '';

    if (prefixes.includes(firstWord) && parts.length > 1) {
      firstWord = parts[1] ?? firstWord;
    }

    // Strip path prefix (e.g., /usr/bin/ls -> ls)
    const basename = firstWord.split('/').pop() || firstWord;
    return basename;
  }
}
