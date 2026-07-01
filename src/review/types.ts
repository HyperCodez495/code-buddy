/**
 * Diff review — data contracts for the pre-application review gate.
 *
 * A producer (single agent, council synthesis, human) PROPOSES a diff with
 * full before/after content; a structured review validates / rejects /
 * annotates it BEFORE anything touches the working tree; an accepted diff is
 * applied transactionally (checkpoint + all-or-nothing) with rollback.
 *
 * Verdict semantics:
 *  - `accept`   → apply. Suggestions may ride along, they don't block.
 *  - `annotate` → do NOT apply; return the annotations to the proposer for a
 *                 revision round (a "request changes").
 *  - `reject`   → never apply. Blockers explain why.
 *
 * Fail-closed discipline (mirrors the council judge's abstention): a diff
 * that CANNOT be reviewed as configured (LLM down, non-JSON verdict, timeout)
 * is NOT silently applied — the verdict is `reject` with `failClosed: true`
 * so the caller can distinguish "rejected on merit" from "unreviewable,
 * retry later".
 *
 * @module review/types
 */

import type { CouncilChatClient } from '../council/types.js';

export type ReviewDecision = 'accept' | 'reject' | 'annotate';

export type AnnotationSeverity = 'blocker' | 'warning' | 'suggestion';

export type FileAction = 'modify' | 'create' | 'delete';

export interface ProposedFileChange {
  /** Path relative to the diff's workDir (never absolute, never escaping). */
  path: string;
  action: FileAction;
  /** Full base content at proposal time; null for `create`. */
  baseContent: string | null;
  /** sha256(baseContent) short hash captured at proposal time; null for `create`. */
  baseHash: string | null;
  /** Full resulting content; null for `delete`. */
  newContent: string | null;
}

export interface ProposedDiff {
  id: string;
  createdAt: string;
  workDir: string;
  origin: { kind: 'agent' | 'council' | 'human'; label: string };
  /** What the producer was trying to achieve — reviewers judge the diff against this. */
  intent: string;
  files: ProposedFileChange[];
}

export interface ReviewAnnotation {
  path: string;
  /** 1-indexed line in the NEW content when the reviewer could anchor it. */
  line?: number;
  severity: AnnotationSeverity;
  message: string;
  suggestedFix?: string;
}

export interface ReviewerReport {
  /** 'static-gate', a lens id ('correctness', 'security'), or 'conflicts'. */
  reviewer: string;
  decision: ReviewDecision;
  annotations: ReviewAnnotation[];
  /** True when this reviewer could not produce a reliable verdict — fail-closed. */
  failClosed?: boolean;
  model?: string;
}

export interface DiffConflict {
  path: string;
  kind: 'stale-base' | 'missing-file' | 'unexpected-existing' | 'duplicate-path';
  detail: string;
}

export type ReviewMode = 'off' | 'static' | 'full';

export interface ReviewVerdict {
  diffId: string;
  decision: ReviewDecision;
  /** Aggregated, deduped annotations from every reviewer. */
  annotations: ReviewAnnotation[];
  reviewers: ReviewerReport[];
  conflicts: DiffConflict[];
  /**
   * True when the non-accept decision came from UNREVIEWABILITY (reviewer
   * down / non-JSON / timeout), not from merit — the caller may retry.
   */
  failClosed: boolean;
  mode: ReviewMode;
  reviewedAt: string;
}

export type ApplyMode = 'atomic' | 'per-file';

export interface ApplyReport {
  diffId: string;
  applied: boolean;
  appliedFiles: string[];
  skippedFiles: string[];
  /** Checkpoint to rewind to (rollbackAppliedDiff) — null when nothing was written. */
  checkpointId: string | null;
  rolledBack: boolean;
  conflicts: DiffConflict[];
  errors: string[];
}

export interface ReviewLens {
  id: string;
  label: string;
  /** What this reviewer hunts for — injected into its system prompt. */
  focus: string;
}

export interface ReviewEngineDeps {
  /** LLM client for `full` mode (council seam). Absent in `full` mode → fail-closed. */
  client?: CouncilChatClient | null;
  lenses?: ReviewLens[];
  /** Per-reviewer wall-clock cap (default 60s). */
  timeoutMs?: number;
  mode?: ReviewMode;
  /** Injectable clock for deterministic records. */
  now?: () => Date;
  staticGate?: StaticGateOptions;
}

export interface StaticGateOptions {
  /** Path prefixes (relative, forward-slash) a diff must never touch. */
  protectedPaths?: string[];
  maxFiles?: number;
  maxTotalBytes?: number;
}
