/**
 * PaperQA2-lite — prose chunker (Phase 1).
 *
 * Splits a {@link StructuredDoc} into traceable {@link Passage}s on prose
 * boundaries (sentence / paragraph), NOT line boundaries like the code chunker
 * (`src/context/codebase-rag/chunker.ts`). Each passage carries provenance
 * derived from the doc's real spans: the page it begins on, the section it falls
 * under, and its absolute `[charStart, charEnd)` range.
 *
 * Deterministic, bounded, never-throws (empty doc → `[]`).
 */

import { findPageNo, findSectionTitle } from './provenance.js';
import type { ChunkOptions, Passage, StructuredDoc } from './types.js';

const DEFAULT_TARGET_CHARS = 1000;
const DEFAULT_OVERLAP_CHARS = 150;
const DEFAULT_MAX_PASSAGES = 5000;

const MIN_TARGET = 50;
const MAX_TARGET = 100000;
const MAX_PASSAGES_CAP = 1000000;

/**
 * Chunk a structured document into prose passages with derived provenance.
 *
 * @param doc  The structured document produced by `parsePdfStructure`.
 * @param opts Bounded knobs (target size, overlap, passage cap).
 */
export function chunkDocument(doc: StructuredDoc, opts: ChunkOptions = {}): Passage[] {
  try {
    if (!doc || typeof doc.fullText !== 'string' || doc.fullText.length === 0) {
      return [];
    }

    const target = clampInt(opts.targetChars, DEFAULT_TARGET_CHARS, MIN_TARGET, MAX_TARGET);
    const overlap = clampInt(
      opts.overlapChars,
      DEFAULT_OVERLAP_CHARS,
      0,
      Math.floor(target / 2),
    );
    const maxPassages = clampInt(opts.maxPassages, DEFAULT_MAX_PASSAGES, 1, MAX_PASSAGES_CAP);

    const text = doc.fullText;
    const boundaries = computeBoundaries(text);
    const passages: Passage[] = [];

    let start = 0;
    let index = 0;
    while (start < text.length && passages.length < maxPassages) {
      const end = nextBoundaryAtLeast(boundaries, start + target, text.length);

      // Trim whitespace at both edges while KEEPING the slice==text invariant.
      let s = start;
      let e = end;
      while (s < e && isWhitespace(text.charCodeAt(s))) s++;
      while (e > s && isWhitespace(text.charCodeAt(e - 1))) e--;

      if (e > s) {
        const passage: Passage = {
          docId: doc.docId,
          page: findPageNo(s, doc.pages),
          charStart: s,
          charEnd: e,
          text: text.slice(s, e),
          index,
        };
        const section = findSectionTitle(s, doc.sections);
        if (section !== undefined) passage.section = section;
        passages.push(passage);
        index++;
      }

      if (end >= text.length) break;

      // Next window starts `overlap` chars before this window's end, snapped to a
      // boundary. Always make progress (strictly greater than the current start).
      let nextStart = end;
      if (overlap > 0) {
        const candidate = largestBoundaryAtMost(boundaries, end - overlap);
        if (candidate > start) nextStart = candidate;
      }
      start = nextStart > start ? nextStart : end;
    }

    return passages;
  } catch {
    return [];
  }
}

/**
 * Candidate cut offsets: document edges, sentence ends (after `.!?` + space),
 * and paragraph breaks (blank lines, which include our inter-page separators).
 * Sorted ascending, unique.
 */
function computeBoundaries(text: string): number[] {
  const set = new Set<number>([0, text.length]);

  // Sentence boundaries: punctuation, optional closing quote/bracket, then space.
  const sentence = /[.!?]["')\]]?\s+/g;
  let m: RegExpExecArray | null;
  while ((m = sentence.exec(text)) !== null) {
    set.add(m.index + m[0].length);
  }

  // Paragraph boundaries: a newline, optional blank space, another newline.
  const paragraph = /\n[ \t]*\n\s*/g;
  while ((m = paragraph.exec(text)) !== null) {
    set.add(m.index + m[0].length);
  }

  return Array.from(set).sort((a, b) => a - b);
}

/** Smallest boundary >= threshold; falls back to `fallback` (text length). */
function nextBoundaryAtLeast(boundaries: number[], threshold: number, fallback: number): number {
  let lo = 0;
  let hi = boundaries.length - 1;
  let ans = fallback;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const val = boundaries[mid] ?? fallback;
    if (val >= threshold) {
      ans = val;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return ans;
}

/** Largest boundary <= threshold (0 when none). */
function largestBoundaryAtMost(boundaries: number[], threshold: number): number {
  let lo = 0;
  let hi = boundaries.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const val = boundaries[mid] ?? 0;
    if (val <= threshold) {
      ans = val;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** True for space, tab, newline, carriage return, form feed, vertical tab. */
function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11;
}

/** Clamp an optional integer into [min, max] with a fallback default. */
function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}
