/**
 * PaperQA2-lite — Relevance-Contextual Summarization (RCS), Phase 3.
 *
 * The heart of PaperQA2's evidence step: before answering, each retrieved
 * passage is summarized RELATIVE TO THE QUESTION and given a relevance score
 * (0..1). Passages below a threshold are DISCARDED so the grounded answer
 * (`answer.ts`) only ever synthesizes from evidence that was independently
 * judged to bear on the question. This is what keeps the answer honest: an
 * off-topic passage that BM25/embeddings happened to surface never becomes
 * "evidence" just because it was retrieved.
 *
 * Contracts (mirroring the rest of paper-qa):
 *   - **Injectable LLM boundary** — {@link PassageQaLlm}; CI injects a
 *     deterministic fake, so there is NO real LLM/network call in tests.
 *   - **never-throws / degrade** — an LLM that throws or returns unparseable
 *     output on a passage → that passage is DISCARDED (returns `null`), never a
 *     crash. A conservative stance: if we cannot establish relevance, we drop it.
 *   - **bounded** — a hard cap on the number of passages summarized (N passages
 *     ⇒ at most N LLM calls), plus truncation of the passage input and the
 *     produced summary.
 *
 * No provenance is ever fabricated here: RCS only annotates the passages Phase 2
 * produced; their page/section/offset trace is carried through untouched.
 */

import { logger } from '../../utils/logger.js';
import type { ScoredPassage } from './passage-index.js';

// ============================================================================
// LLM boundary (injectable — shared with answer.ts)
// ============================================================================

/** A single chat message for the paper-qa LLM boundary. */
export interface PassageLlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Injectable LLM boundary for paper-qa. Returns the assistant text; MAY throw
 * (callers degrade — a thrown/empty result discards the passage or refuses the
 * answer, never crashes). Mirrors deep-research's `boundaries.llm`.
 */
export type PassageQaLlm = (messages: PassageLlmMessage[]) => Promise<string>;

// ============================================================================
// Public surface
// ============================================================================

/** A passage that survived (or was scored by) RCS: its provenance + LLM verdict. */
export interface PassageSummary {
  /** The retrieved passage being summarized (provenance carried through). */
  scored: ScoredPassage;
  /** Query-focused summary drawn ONLY from the passage (may be empty when useless). */
  summary: string;
  /** Relevance to the question, clamped to 0..1. */
  relevance: number;
}

/** Bounded knobs for RCS. */
export interface RcsOptions {
  /** Discard passages scoring below this relevance (0..1, default 0.5). */
  relevanceThreshold?: number;
  /** Hard cap on passages summarized = hard cap on LLM calls (default 12, 1..200). */
  maxPassages?: number;
  /** Truncate passage text to this many chars before the LLM call (default 2000). */
  passageCharLimit?: number;
  /** Truncate the produced summary to this many chars (default 600). */
  summaryCharLimit?: number;
}

// ============================================================================
// Defaults / bounds
// ============================================================================

const DEFAULT_RELEVANCE_THRESHOLD = 0.5;
/**
 * When a passage parses to a strong relevance but an EMPTY summary, keep the
 * passage (falling back to its raw text as evidence) rather than zeroing it. At
 * or above this floor the model's relevance verdict is trusted; below it, an
 * empty-summary passage is treated as "no useful content" and dropped.
 */
const EMPTY_SUMMARY_KEEP_FLOOR = DEFAULT_RELEVANCE_THRESHOLD;
const DEFAULT_MAX_PASSAGES = 12;
const MAX_PASSAGES_CAP = 200;
const DEFAULT_PASSAGE_CHAR_LIMIT = 2000;
const DEFAULT_SUMMARY_CHAR_LIMIT = 600;

const RCS_SYSTEM = [
  'You judge whether a single passage helps answer a question, and summarize only the parts that do.',
  'Output EXACTLY two lines and nothing else:',
  'RELEVANCE: <a number between 0 and 1>',
  'SUMMARY: <one or two sentences drawn ONLY from the passage; write NONE if the passage does not help>',
  'Use ONLY information present in the passage. Do NOT add outside knowledge. Do NOT invent.',
].join('\n');

// ============================================================================
// Single-passage RCS
// ============================================================================

/**
 * Summarize ONE passage relative to `question` and score its relevance (0..1).
 *
 * One LLM call via the injected boundary. Returns `null` when the passage must
 * be discarded: the LLM threw, returned empty, or produced output without a
 * parseable relevance (we refuse to guess relevance). A parseable result whose
 * summary is empty/NONE is returned with `relevance: 0` so the threshold filter
 * drops it while distinguishing "no useful content" from "LLM failure".
 *
 * Never throws.
 */
export async function summarizePassage(
  scored: ScoredPassage,
  question: string,
  llm: PassageQaLlm,
  opts: RcsOptions = {},
): Promise<PassageSummary | null> {
  const passageCharLimit = clampInt(opts.passageCharLimit, DEFAULT_PASSAGE_CHAR_LIMIT, 1, 100_000);
  const summaryCharLimit = clampInt(opts.summaryCharLimit, DEFAULT_SUMMARY_CHAR_LIMIT, 1, 100_000);

  const q = typeof question === 'string' ? question.trim() : '';
  if (q.length === 0) return null;

  const passageText = truncate(scored.passage.text, passageCharLimit);
  const userPrompt = [`Question: ${q}`, '', 'Passage:', passageText].join('\n');

  let raw: string;
  try {
    raw = await llm([
      { role: 'system', content: RCS_SYSTEM },
      { role: 'user', content: userPrompt },
    ]);
  } catch (err) {
    logger.debug(`[paper-qa] RCS LLM failed on a passage, discarding: ${errText(err)}`);
    return null;
  }

  const parsed = parseRcsOutput(raw, summaryCharLimit);
  if (!parsed) return null;
  // Strong relevance but an empty summary (finding C-a): fall back to the raw
  // passage text so the retained evidence still reaches the synthesizer instead
  // of being silently discarded. A zeroed (weak) passage keeps its empty summary
  // — the threshold filter drops it anyway.
  const summary =
    parsed.summary.length > 0
      ? parsed.summary
      : parsed.relevance > 0
        ? truncate(scored.passage.text.replace(/\s+/g, ' ').trim(), summaryCharLimit)
        : '';
  return { scored, summary, relevance: parsed.relevance };
}

// ============================================================================
// Batched RCS (the filter)
// ============================================================================

/**
 * Run RCS over a ranked passage list and RETAIN only the relevant ones.
 *
 * Caps the work to `maxPassages` (⇒ at most that many LLM calls), summarizes
 * each (sequentially, deterministic), drops failures (`null`) and any passage
 * scoring below `relevanceThreshold`, and returns the survivors sorted by RCS
 * relevance descending (tie-break on the retrieval score) so the strongest
 * evidence is numbered first by the answer synthesizer. Never throws.
 */
export async function summarizePassages(
  passages: ScoredPassage[],
  question: string,
  llm: PassageQaLlm,
  opts: RcsOptions = {},
): Promise<PassageSummary[]> {
  if (!Array.isArray(passages) || passages.length === 0) return [];

  const threshold = clampFloat(opts.relevanceThreshold, DEFAULT_RELEVANCE_THRESHOLD, 0, 1);
  const maxPassages = clampInt(opts.maxPassages, DEFAULT_MAX_PASSAGES, 1, MAX_PASSAGES_CAP);
  const considered = passages.slice(0, maxPassages);

  const retained: PassageSummary[] = [];
  for (const scored of considered) {
    const summary = await summarizePassage(scored, question, llm, opts);
    if (summary && summary.relevance >= threshold) retained.push(summary);
  }

  retained.sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    return b.scored.scores.final - a.scored.scores.final;
  });
  return retained;
}

// ============================================================================
// Parsing
// ============================================================================

/** Parse the `RELEVANCE:`/`SUMMARY:` contract; `null` when relevance is unparseable. */
function parseRcsOutput(
  raw: unknown,
  summaryCharLimit: number,
): { summary: string; relevance: number } | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;

  const relevance = parseRelevance(raw);
  if (relevance === null) return null;

  const summary = extractSummary(raw);
  if (summary.length === 0 || /^none\b/i.test(summary)) {
    // Parseable relevance but no distilled summary. Don't blindly zero the
    // relevance: a STRONGLY-relevant passage the model simply didn't summarise
    // was being silently discarded (finding C-a). Keep the parsed relevance when
    // it is strong (the caller then falls back to the raw passage text as
    // evidence); otherwise force it below any positive threshold so genuinely
    // useless passages still drop, distinct from an LLM failure (null).
    if (relevance >= EMPTY_SUMMARY_KEEP_FLOOR) return { summary: '', relevance };
    return { summary: '', relevance: 0 };
  }
  return { summary: truncate(summary, summaryCharLimit), relevance };
}

/**
 * Extract the relevance number, clamped to 0..1.
 *
 * Scale handling (finding C-b): a `%` sign is an explicit 0..100 scale (÷100).
 * WITHOUT a `%`, we do NOT assume 0..100 — that turned "RELEVANCE: 8" (an 8/10
 * grade) into 0.08 and silently dropped strong evidence. A bare number > 1 is
 * read as the common 0..10 grade (÷10); anything above 10 clamps to the maximum.
 */
function parseRelevance(raw: string): number | null {
  const m = raw.match(/relevance\s*[:=]\s*(-?\d+(?:[.,]\d+)?)(\s*%)?/i);
  if (!m || m[1] === undefined) return null;
  let val = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(val)) return null;
  if (m[2]) {
    val = val / 100; // explicit percent → 0..100 scale
  } else if (val > 1) {
    val = val <= 10 ? val / 10 : 1; // bare 0..10 grade; clamp above 10
  }
  return Math.min(1, Math.max(0, val));
}

/** Extract the summary text (after the `SUMMARY:` label, else the non-relevance remainder). */
function extractSummary(raw: string): string {
  const labelled = raw.match(/summary\s*[:=]\s*([\s\S]*)$/i);
  if (labelled && labelled[1] !== undefined) return labelled[1].trim();
  // No SUMMARY label: fall back to the text with the RELEVANCE line removed.
  return raw
    .replace(/relevance\s*[:=]\s*-?\d+(?:[.,]\d+)?\s*%?/i, '')
    .trim();
}

// ============================================================================
// Helpers
// ============================================================================

function truncate(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function clampFloat(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
