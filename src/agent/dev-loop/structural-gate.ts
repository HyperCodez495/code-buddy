/**
 * Structural gate — the zero-LLM verification layer of the dev-loop
 * (jarvis-OS Verifier layer 1, clean-room concept).
 *
 * Runs BEFORE the (paid, slower) independent Verifier on the files the turn
 * actually touched, and catches the unambiguous failures no LLM judgment is
 * needed for: empty files, unresolved merge-conflict markers, omission
 * placeholders ("// ... rest of code"), unparsable JSON. Any hit ⇒ the turn is
 * NOT verifiable as done — the loop can skip the LLM Verifier entirely and
 * feed the issues straight back to the next turn.
 *
 * Fail-open by design: not a git repo, git missing, unreadable file — the
 * gate abstains (returns null) and the normal verifier runs. It must never
 * block a loop on its own infrastructure problems, only on real defects.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { detectOmissionPlaceholders } from '../../tools/omission-placeholder-detector.js';
import { logger } from '../../utils/logger.js';

const execFileAsync = promisify(execFile);

const MAX_FILES_CHECKED = 50;
const MAX_FILE_BYTES = 512 * 1024;
const CONFLICT_MARKERS = ['<<<<<<< ', '>>>>>>> '];

export interface StructuralIssue {
  file: string;
  issue: string;
}

/** `git status --porcelain` as a map path → status line (fail-open: null). */
export async function gitStatusSnapshot(cwd: string): Promise<Map<string, string> | null> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
    });
    const map = new Map<string, string>();
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      // porcelain v1: XY <path> (or XY <old> -> <new> for renames — keep <new>)
      const p = line.slice(3).split(' -> ').pop()?.trim();
      if (p) map.set(p, line.slice(0, 2));
    }
    return map;
  } catch {
    return null; // not a git repo / git unavailable → abstain
  }
}

/** Files whose porcelain status appeared or changed between two snapshots. */
export function changedFilesBetween(
  before: Map<string, string> | null,
  after: Map<string, string> | null,
): string[] {
  if (!before || !after) return [];
  const changed: string[] = [];
  for (const [file, status] of after) {
    if (before.get(file) !== status) changed.push(file);
  }
  return changed;
}

/** Pure per-file checks. Exported for tests. */
export function checkFileContent(file: string, content: string): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  if (content.trim().length === 0) {
    issues.push({ file, issue: 'file is empty' });
    return issues;
  }
  for (const marker of CONFLICT_MARKERS) {
    if (content.includes(marker)) {
      issues.push({ file, issue: `unresolved merge-conflict marker "${marker.trim()}"` });
      break;
    }
  }
  const omissions = detectOmissionPlaceholders(content);
  if (omissions.hasOmissions) {
    issues.push({
      file,
      issue: `omission placeholder left in file (line ${omissions.lines[0]}: "${omissions.matches[0]}")`,
    });
  }
  if (file.endsWith('.json')) {
    try {
      JSON.parse(content);
    } catch (error) {
      issues.push({ file, issue: `invalid JSON (${String(error).slice(0, 120)})` });
    }
  }
  return issues;
}

/**
 * Check the given files on disk. Deleted files and oversized files are
 * skipped (a deletion is not a structural defect; huge files are not worth
 * a synchronous read on every turn).
 */
export async function structuralCheck(cwd: string, files: string[]): Promise<StructuralIssue[]> {
  const issues: StructuralIssue[] = [];
  for (const file of files.slice(0, MAX_FILES_CHECKED)) {
    const abs = path.resolve(cwd, file);
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      const content = await fs.readFile(abs, 'utf-8');
      issues.push(...checkFileContent(file, content));
    } catch {
      continue; // deleted/unreadable → not this gate's business
    }
  }
  if (files.length > MAX_FILES_CHECKED) {
    logger.debug('structural gate: file list truncated', {
      checked: MAX_FILES_CHECKED,
      total: files.length,
    });
  }
  return issues;
}

export function formatStructuralEvidence(issues: StructuralIssue[]): string {
  return issues.map((i) => `- ${i.file}: ${i.issue}`).join('\n');
}
