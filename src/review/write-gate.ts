/**
 * Write gate — the shared review entry for every gated write flow
 * (apply_patch, create_file and its write_file alias).
 *
 * Takes resolved FULL before/after content, routes it through
 * `reviewAndApply` (review → transactional apply → audit ledger) and formats
 * the verdict FOR THE AGENT: a reject/annotate comes back as an actionable
 * message carrying the line-anchored annotations so the proposer can revise —
 * never a silent loss.
 *
 * In `full` mode with no injected client, a default reviewer is resolved from
 * the active-LLM pool (dead models skipped via the scoreboard); none
 * available → the engine fails closed.
 *
 * @module review/write-gate
 */

import { reviewAndApply } from './review-engine.js';
import { resolveDefaultReviewClient } from './llm-client.js';
import type { CouncilChatClient } from '../council/types.js';
import type { ApplyMode, ReviewAnnotation, ReviewMode } from './types.js';
import type { ProposedChangeInput } from './diff-model.js';

export interface ReviewGatedWriteInput {
  changes: ProposedChangeInput[];
  cwd: string;
  intent: string;
  /** Producer label journaled in the ledger (default 'agent-write'). */
  originLabel?: string;
}

export interface ReviewGatedWriteDeps {
  mode: Exclude<ReviewMode, 'off'>;
  /** Injected reviewer client; undefined in `full` mode → resolved from the pool; null → fail-closed. */
  client?: CouncilChatClient | null;
  timeoutMs?: number;
  applyMode?: ApplyMode;
}

export interface ReviewGatedWriteOutcome {
  ok: boolean;
  summary: string;
}

export function formatReviewAnnotations(annotations: ReviewAnnotation[]): string {
  return annotations
    .map((a) => {
      const anchor = a.line ? `${a.path}:${a.line}` : a.path;
      const fix = a.suggestedFix ? ` (fix: ${a.suggestedFix})` : '';
      return `  [${a.severity}] ${anchor} — ${a.message}${fix}`;
    })
    .join('\n');
}

export async function reviewGatedWrite(
  input: ReviewGatedWriteInput,
  deps: ReviewGatedWriteDeps,
): Promise<ReviewGatedWriteOutcome> {
  const client =
    deps.mode === 'full' ? (deps.client !== undefined ? deps.client : await resolveDefaultReviewClient()) : null;

  const { verdict, apply } = await reviewAndApply(
    {
      workDir: input.cwd,
      intent: input.intent,
      origin: { kind: 'agent', label: input.originLabel ?? 'agent-write' },
      changes: input.changes,
    },
    {
      mode: deps.mode,
      client,
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
    },
    { ...(deps.applyMode !== undefined ? { mode: deps.applyMode } : {}) },
  );

  const reviewers = verdict.reviewers.map((r) => r.reviewer).join(', ');

  if (verdict.decision === 'accept' && apply?.applied) {
    const lines = [
      `review accepted (${verdict.mode}: ${reviewers}) — applied: ${apply.appliedFiles.join(', ')}`,
    ];
    const suggestions = verdict.annotations.filter((a) => a.severity === 'suggestion');
    if (suggestions.length > 0) {
      lines.push('non-blocking suggestions:', formatReviewAnnotations(suggestions));
    }
    return { ok: true, summary: lines.join('\n') };
  }

  if (verdict.decision === 'accept' && apply && !apply.applied) {
    // Accepted but the transaction refused (apply-time conflict) or failed (rolled back).
    const lines = [
      `review accepted but apply ${apply.rolledBack ? 'failed and was rolled back' : 'aborted'}:`,
      ...apply.errors.map((e) => `  ${e}`),
      ...apply.conflicts.map((c) => `  [conflict] ${c.path}: ${c.kind} — ${c.detail}`),
      'Nothing was left half-applied. Re-read the files and re-propose against the current base.',
    ];
    return { ok: false, summary: lines.join('\n') };
  }

  const header = verdict.failClosed
    ? `review UNAVAILABLE (${verdict.mode}) — fail-closed, nothing applied. Retry later or run with CODEBUDDY_DIFF_REVIEW=static.`
    : verdict.decision === 'reject'
      ? `review REJECTED the change (${verdict.mode}: ${reviewers}) — nothing applied.`
      : `review requests changes (${verdict.mode}: ${reviewers}) — nothing applied. Revise to address the annotations, then retry.`;

  return {
    ok: false,
    summary: [header, formatReviewAnnotations(verdict.annotations)].filter(Boolean).join('\n'),
  };
}
