/**
 * Video understanding — Collective Knowledge Graph (CKG) ingestion bridge.
 *
 * Mirrors the INGEST leg of `agent/deep-research-ckg.ts` (Deep Research's Phase D)
 * for video understanding: the Collective Knowledge Graph (`memory/collective-
 * knowledge-graph.ts`) is the collective's SHARED, cross-run/cross-agent memory —
 * an append-only ledger whose `ingest()` auto-links a discovery to its nearest
 * neighbours and CORROBORATES a fact several independent agents/runs surface.
 *
 * Today video understanding (`video-understanding.ts`) produces a rich, timestamped
 * transcript (+ optional visual/cloud understanding) and then forgets it — nothing
 * capitalizes across runs. This module bridges the "perception → memory" gap: when
 * the robot understands a video, ONE bounded summary is deposited into the graph as
 * a `discovery` node (name = the video source URL/path, text = a short summary + a
 * few key transcript excerpts — NEVER the full transcript), so a later chat turn
 * (`agent/execution/context-pipeline.ts`) or the self-improvement loop can recall
 * "what did we learn from that video" without re-watching it.
 *
 * STRICTLY ADDITIVE / OPT-IN / never-throws, exactly like Phase D:
 *  - The caller (`understandVideo`) only invokes this when the SHARED
 *    `CODEBUDDY_COLLECTIVE_MEMORY=true` env gate is on (same gate as Deep Research's
 *    Phase D and `context-pipeline.ts`'s collective-graph injection) — no new tool
 *    parameter. Gate off ⇒ this module is never touched, `understandVideo`'s return
 *    value is byte-identical to today.
 *  - The single side-effecting edge — the CKG — is the INJECTABLE `VideoCkgBridge`,
 *    so ingestion is unit-testable with zero ledger / zero network. Any bridge
 *    failure degrades silently: video understanding always succeeds regardless of
 *    ingestion outcome.
 *  - Idempotent by construction: the stable `name` (the video source) means a repeat
 *    run of the SAME video reconciles via the CKG's contentHash (identical text
 *    reinforces the existing node; changed text supersedes it) instead of
 *    duplicating — the CKG core (untouched here) already guarantees this.
 *  - Bounded: ONE node per video, and the ingested text is capped well short of a
 *    full transcript (default 800 chars, hard cap 4000) — a short summary/answer
 *    plus a handful of spread-out transcript excerpts, never the whole transcript.
 *
 * @module tools/video/video-ckg
 */

import { logger } from '../../utils/logger.js';

// ============================================================================
// Data types
// ============================================================================

/** Minimal transcript segment shape this module needs (structurally compatible with
 *  `TimedSegment` from `long-transcribe.js` without importing it — keeps this module
 *  a leaf, decoupled from `video-understanding.ts`). */
export interface VideoCkgSegment {
  said: string;
}

/** What `understandVideo` hands over for ingestion — deliberately NOT the full
 *  `UnderstandVideoSuccess` shape, so this module stays independent of
 *  `video-understanding.ts` (no import cycle). */
export interface VideoCkgSourceInfo {
  /** The original source (URL or local path) — used as the stable node name + provenance. */
  source: string;
  /** Resolution method (provenance, e.g. 'youtube-captions'). */
  method: string;
  /** Timestamped transcript segments. Only a FEW are excerpted as "key facts" —
   *  never the whole transcript. */
  segments: VideoCkgSegment[];
  /** A richer answer/summary when available (e.g. the cloud/Gemini answer) —
   *  preferred as the primary ingested text over a transcript digest. */
  answer?: string;
  /** The question asked, if any (fallback context when no richer answer exists). */
  question?: string;
}

/** Payload handed to the bridge — the CKG-facing shape (mirrors `CkgRememberInput`
 *  without importing it, keeping the bridge interface minimal and self-contained). */
export interface VideoCkgIngestPayload {
  /** Stable name (the video source) — the CKG dedups/supersedes on this + contentHash. */
  name: string;
  /** The bounded summary text to store. */
  text: string;
  /** Provenance tag (default 'video-understanding'). */
  source: string;
  /** Contributing agent id (attribution). */
  agentId?: string;
}

/**
 * The ONLY seam this module needs — an injectable adapter over the Collective
 * Knowledge Graph. The real implementation (`getDefaultVideoCkgBridge`) wraps
 * `CollectiveKnowledgeGraph.ingest`; tests inject a fake so nothing touches a ledger.
 * Expected to never throw (impls guard), but callers guard it anyway.
 */
export interface VideoCkgBridge {
  /** Ingest ONE video-understanding discovery. Return value is opaque (truthy on
   *  success) — callers only care whether ingestion happened, not the stored shape. */
  ingest(payload: VideoCkgIngestPayload): Promise<unknown>;
}

/** Bounds + attribution for the ingested node (all optional, all clamped). */
export interface VideoCkgIngestOptions {
  /** Max chars of the ingested text (default 800, clamped [200, 4000]). */
  maxChars?: number;
  /** Max number of transcript excerpts folded into the text (default 3, clamped [1, 6]). */
  maxFacts?: number;
  /** Contributing agent id written on the ingested node (attribution). */
  agentId?: string;
  /** Provenance tag written on the ingested node (default 'video-understanding'). */
  sourceTag?: string;
}

const DEFAULT_MAX_CHARS = 800;
const MIN_CHARS = 200;
const MAX_CHARS = 4000;
const DEFAULT_MAX_FACTS = 3;
const MAX_FACTS_CAP = 6;

function clampInt(v: number | undefined, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(min, Math.min(max, n));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Truncate at a word boundary when reasonably close to the limit, else hard-cut;
 *  marks truncation with a trailing ellipsis. Never throws, never exceeds `maxChars`. */
function truncateCleanly(s: string, maxChars: number): string {
  const trimmed = s.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const hardCut = trimmed.slice(0, Math.max(0, maxChars - 1));
  const lastSpace = hardCut.lastIndexOf(' ');
  const cut = lastSpace > maxChars * 0.6 ? hardCut.slice(0, lastSpace) : hardCut;
  return `${cut.trimEnd()}…`;
}

/**
 * Pick up to `maxFacts` transcript excerpts SPREAD across the transcript (not just
 * the intro) — evenly-spaced indices from first to last segment with non-empty
 * speech. Each excerpt is bounded to `maxCharsEach`. Returns [] for an empty
 * transcript. Never throws.
 */
function pickKeyFacts(segments: VideoCkgSegment[], maxFacts: number, maxCharsEach: number): string[] {
  const texts = segments.map((s) => collapseWhitespace(s.said ?? '')).filter((t) => t.length > 0);
  if (texts.length === 0) return [];
  if (texts.length <= maxFacts) {
    return texts.map((t) => truncateCleanly(t, maxCharsEach));
  }
  const picked: string[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < maxFacts; i++) {
    const idx = maxFacts === 1 ? 0 : Math.round((i * (texts.length - 1)) / (maxFacts - 1));
    if (seen.has(idx)) continue;
    seen.add(idx);
    const t = texts[idx];
    if (t !== undefined) picked.push(truncateCleanly(t, maxCharsEach));
  }
  return picked;
}

// ============================================================================
// Bounded summary text (pure, testable)
// ============================================================================

/**
 * Build the bounded ingestion text: a provenance header, the primary summary
 * (the richer `answer` when available, else the asked `question`, else nothing),
 * and a handful of spread-out transcript excerpts — truncated cleanly to
 * `opts.maxChars`. NEVER the full transcript.
 */
export function buildVideoIngestText(info: VideoCkgSourceInfo, opts: VideoCkgIngestOptions = {}): string {
  const maxChars = clampInt(opts.maxChars, DEFAULT_MAX_CHARS, MIN_CHARS, MAX_CHARS);
  const maxFacts = clampInt(opts.maxFacts, DEFAULT_MAX_FACTS, 1, MAX_FACTS_CAP);

  const header = `Vidéo (${info.method}) — ${info.source}`;
  const answer = collapseWhitespace(info.answer ?? '');
  const question = collapseWhitespace(info.question ?? '');
  const primary = answer || (question ? `Question : ${question}` : '');

  const perFactBudget = Math.max(60, Math.floor(maxChars / (maxFacts + 1)));
  const facts = pickKeyFacts(info.segments ?? [], maxFacts, perFactBudget);

  const parts = [header];
  if (primary) parts.push(primary);
  if (facts.length > 0) parts.push(`Extraits clés : ${facts.join(' | ')}`);

  return truncateCleanly(parts.join('\n'), maxChars);
}

// ============================================================================
// Ingest (write) — bounded, idempotent, never-throws
// ============================================================================

/**
 * Ingest a video's understanding into the collective graph as ONE `discovery` node.
 * Best-effort, never-throws (a bridge failure or thrown error yields `false`).
 * Skips silently (returns `false`, bridge never called) when there is nothing
 * meaningful to store — no answer, no question, and an empty/silent transcript.
 */
export async function ingestVideoUnderstanding(
  info: VideoCkgSourceInfo,
  bridge: VideoCkgBridge,
  opts: VideoCkgIngestOptions = {},
): Promise<boolean> {
  try {
    const source = (info.source ?? '').trim();
    if (!source) return false;

    const hasAnswer = Boolean((info.answer ?? '').trim());
    const hasQuestion = Boolean((info.question ?? '').trim());
    const hasTranscript = (info.segments ?? []).some((s) => (s.said ?? '').trim().length > 0);
    if (!hasAnswer && !hasQuestion && !hasTranscript) return false;

    const text = buildVideoIngestText(info, opts);
    const stored = await bridge.ingest({
      name: source,
      text,
      source: opts.sourceTag ?? 'video-understanding',
      ...(opts.agentId ? { agentId: opts.agentId } : {}),
    });
    return stored !== null && stored !== undefined && stored !== false;
  } catch (err) {
    logger.debug(`[video-ckg] ingest failed: ${errMsg(err)}`);
    return false;
  }
}

// ============================================================================
// Real bridge wiring (lazy — only imported when the caller's gate is on)
// ============================================================================

/**
 * Default CKG bridge over the process-wide collective graph. Lazily dynamic-imports
 * `memory/collective-knowledge-graph.ts` (heavy: embeddings, BM25) so disabled runs
 * never pay for it — the caller only invokes this factory when the shared
 * `CODEBUDDY_COLLECTIVE_MEMORY` gate is already on. Never throws: any failure
 * (including the dynamic import itself) is caught, so a broken CKG never breaks
 * video understanding.
 */
export async function getDefaultVideoCkgBridge(): Promise<VideoCkgBridge> {
  const { getCollectiveKnowledgeGraph } = await import('../../memory/collective-knowledge-graph.js');
  const ckg = getCollectiveKnowledgeGraph();
  return {
    ingest: async (payload: VideoCkgIngestPayload) => {
      try {
        return await ckg.ingest({
          type: 'discovery',
          name: payload.name,
          text: payload.text,
          source: payload.source,
          ...(payload.agentId ? { agentId: payload.agentId } : {}),
        });
      } catch (err) {
        logger.debug(`[video-ckg] real bridge ingest failed: ${errMsg(err)}`);
        return null;
      }
    },
  };
}
