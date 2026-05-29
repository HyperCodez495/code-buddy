/**
 * Pure path / contract-scope helpers shared by the agentic-coding runner and
 * its sibling modules (edit-proposal-producer, verification-loop, ...).
 *
 * Extracted from agentic-coding-runner.ts to break the
 * `agentic-coding-runner → edit-proposal-producer → agentic-coding-runner`
 * import cycle (Phase-2 circular-dep cleanup, 2026-05-29) and to start
 * decomposing the 8.4K-LOC god file. Keep this module dependency-free of any
 * runner/sibling module so it never re-introduces a cycle.
 */
import * as path from 'node:path';

/** Normalize a git-reported path: trim, forward-slashes, strip surrounding quotes. */
export function normalizeGitPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^"|"$/g, '');
}

/** True when `filePath` falls inside one of the contract's allowed path scopes
 *  (supports trailing `/...` recursive-scope syntax). */
export function isPathAllowedByContract(filePath: string, allowedPaths: string[]): boolean {
  const normalizedPath = normalizeGitPath(filePath);

  return allowedPaths.some((scope) => {
    const normalizedScope = normalizeGitPath(scope);

    if (normalizedScope.endsWith('/...')) {
      const prefix = normalizedScope.slice(0, -3);
      return normalizedPath.startsWith(prefix);
    }

    return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
  });
}

/** Resolve `filePath` against `repo`, refusing paths that escape the repo root. */
export function resolveRepoPath(repo: string, filePath: string): { path?: string; reason?: string } {
  const normalizedPath = normalizeGitPath(filePath);
  const resolved = path.resolve(repo, normalizedPath);
  const relative = path.relative(repo, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { reason: `path escapes repository: ${filePath}` };
  }

  return { path: resolved };
}
