/**
 * Static gate — deterministic, zero-LLM checks every proposed diff passes
 * FIRST. Cheap, reproducible, and unbluffable: a diff that fails here is
 * rejected without spending a single reviewer token.
 *
 * Checks: omission placeholders (reuses the text-editor's detector — the
 * "// ... rest of code" class of truncation), introduced secrets, protected
 * paths, diff size caps, suspicious massive shrink, and no-op changes.
 *
 * @module review/static-gate
 */

import { detectOmissionPlaceholders } from '../tools/omission-placeholder-detector.js';
import type {
  ProposedDiff,
  ReviewAnnotation,
  ReviewerReport,
  StaticGateOptions,
} from './types.js';

const DEFAULT_PROTECTED_PATHS = ['.git/', 'node_modules/'];
const DEFAULT_MAX_FILES = 50;
const DEFAULT_MAX_TOTAL_BYTES = 1_000_000;

/** Patterns for secrets a diff must never INTRODUCE (checked new-vs-base). */
const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { label: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'GitHub token', pattern: /\bghp_[A-Za-z0-9]{36}\b/ },
  { label: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'hardcoded credential assignment', pattern: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][A-Za-z0-9_\-/+]{20,}["']/i },
];

function firstLineMatching(content: string, pattern: RegExp): number | undefined {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i]!)) return i + 1;
  }
  return undefined;
}

export function runStaticGate(diff: ProposedDiff, opts: StaticGateOptions = {}): ReviewerReport {
  const protectedPaths = opts.protectedPaths ?? DEFAULT_PROTECTED_PATHS;
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const annotations: ReviewAnnotation[] = [];

  if (diff.files.length > maxFiles) {
    annotations.push({
      path: diff.files[0]!.path,
      severity: 'blocker',
      message: `diff touches ${diff.files.length} files (cap ${maxFiles}) — split it`,
    });
  }
  const totalBytes = diff.files.reduce(
    (sum, f) => sum + (f.newContent?.length ?? 0) + (f.baseContent?.length ?? 0),
    0,
  );
  if (totalBytes > maxTotalBytes) {
    annotations.push({
      path: diff.files[0]!.path,
      severity: 'blocker',
      message: `diff weighs ${totalBytes} bytes (cap ${maxTotalBytes}) — split it`,
    });
  }

  for (const file of diff.files) {
    if (protectedPaths.some((p) => file.path === p || file.path.startsWith(p))) {
      annotations.push({
        path: file.path,
        severity: 'blocker',
        message: `protected path — a reviewed diff must never touch ${file.path}`,
      });
      continue;
    }

    if (file.newContent !== null) {
      // Truncation markers: the same detector the edit tool uses, skipping
      // placeholders already present in the base (no false positives on
      // legitimately elided docs).
      const omissions = detectOmissionPlaceholders(file.newContent, file.baseContent ?? undefined);
      if (omissions.hasOmissions) {
        annotations.push({
          path: file.path,
          line: omissions.lines[0],
          severity: 'blocker',
          message: `omission placeholder in new content (${omissions.matches[0] ?? 'elided block'}) — the diff would truncate the file`,
        });
      }

      for (const { label, pattern } of SECRET_PATTERNS) {
        const introduced = pattern.test(file.newContent) && !(file.baseContent !== null && pattern.test(file.baseContent));
        if (introduced) {
          annotations.push({
            path: file.path,
            line: firstLineMatching(file.newContent, pattern),
            severity: 'blocker',
            message: `introduces a ${label} — secrets never go through a reviewed diff`,
          });
        }
      }
    }

    if (file.action === 'modify' && file.baseContent !== null && file.newContent !== null) {
      if (file.newContent === file.baseContent) {
        annotations.push({
          path: file.path,
          severity: 'suggestion',
          message: 'no-op change (new content identical to base) — drop this file from the diff',
        });
      } else if (file.baseContent.length > 500 && file.newContent.length < file.baseContent.length * 0.1) {
        annotations.push({
          path: file.path,
          severity: 'warning',
          message: `new content is ${file.newContent.length} bytes vs ${file.baseContent.length} base — looks like accidental truncation; confirm the shrink is intended`,
        });
      }
    }
  }

  const decision = annotations.some((a) => a.severity === 'blocker')
    ? 'reject'
    : annotations.some((a) => a.severity === 'warning')
      ? 'annotate'
      : 'accept';

  return { reviewer: 'static-gate', decision, annotations };
}
