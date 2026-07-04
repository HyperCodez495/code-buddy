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
import type { ChunkOptions, PageSpan, Passage, SectionSpan, StructuredDoc } from './types.js';

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
    // Page starts are HARD cut points: a passage must never straddle a page, so
    // `findPageNo(charStart)` alone is exact (the core "cite the right page"
    // promise). Without this a window sized by `target` can span several pages
    // and get mis-attributed to the page it merely BEGAN on.
    const hardCuts = computeHardCuts(doc.pages, doc.sections, text.length);
    const passages: Passage[] = [];

    let start = 0;
    let index = 0;
    while (start < text.length && passages.length < maxPassages) {
      // Bound the window by the next page frontier after `start`: a chunk ends at
      // the earlier of its natural prose boundary and the next page boundary.
      const hardEnd = nextHardCutAfter(hardCuts, start, text.length);
      const end = Math.min(nextBoundaryAtLeast(boundaries, start + target, text.length), hardEnd);
      // True when this window closed ON a page frontier (not just EOF).
      const endedOnHardCut = hardEnd < text.length && end === hardEnd;

      // Trim whitespace at both edges while KEEPING the slice==text invariant.
      // The inter-page separator ('\n\n') lands at a window edge here and is
      // trimmed away, so no empty passage is created for it.
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
      // When the window closed on a page frontier we DON'T carry overlap back into
      // the finished page — the overlap stays within its own segment, so the next
      // passage begins cleanly on the new page (no cross-page bleed).
      let nextStart = end;
      if (overlap > 0 && !endedOnHardCut) {
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

/**
 * Hard cut offsets a chunk window may never cross (in `]0, len[`), sorted unique:
 *   - the `charStart` of every page after the first, so a passage stays on ONE
 *     page (`findPageNo(charStart)` is then exact);
 *   - the `charStart` of every section, so a passage never STRADDLES a section
 *     boundary and get mis-labelled by its start offset. A previous section's
 *     span can bleed across a page onto a page's pre-heading title line (e.g. a
 *     page-2 line before its "Methods" heading), so without a section cut the
 *     chunk that begins there — and carries the section's real facts — inherits
 *     the bled-in "Introduction" instead of "Methods" (finding D1).
 */
function computeHardCuts(
  pages: readonly PageSpan[],
  sections: readonly SectionSpan[],
  len: number,
): number[] {
  const set = new Set<number>();
  for (const page of pages) {
    if (page.charStart > 0 && page.charStart < len) set.add(page.charStart);
  }
  for (const section of sections) {
    if (section.charStart > 0 && section.charStart < len) set.add(section.charStart);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** Smallest hard cut strictly greater than `start`; `fallback` (text length) when none. */
function nextHardCutAfter(hardCuts: number[], start: number, fallback: number): number {
  let lo = 0;
  let hi = hardCuts.length - 1;
  let ans = fallback;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const val = hardCuts[mid] ?? fallback;
    if (val > start) {
      ans = val;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return ans;
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
