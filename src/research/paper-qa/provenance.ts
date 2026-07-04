/**
 * PaperQA2-lite — provenance lookups.
 *
 * Pure helpers that map an absolute character offset in `StructuredDoc.fullText`
 * back to the physical page and detected section it belongs to. Shared by the
 * structural parser and the prose chunker so both derive provenance identically.
 */

import type { PageSpan, SectionSpan } from './types.js';

/**
 * Resolve the 1-based page number that contains `offset`.
 *
 * Pages are stored in order with small separator gaps between them; an offset
 * that lands inside such a gap is attributed to the following page. Falls back
 * to the last page (or 1) so this never returns an invalid page.
 */
export function findPageNo(offset: number, pages: readonly PageSpan[]): number {
  if (pages.length === 0) return 1;
  for (const page of pages) {
    if (offset < page.charEnd) return page.pageNo;
  }
  const last = pages[pages.length - 1];
  return last ? last.pageNo : 1;
}

/**
 * Resolve the section title that spans `offset`, if any.
 *
 * Sections partition the text from the first heading onward (non-overlapping),
 * so a simple containment check suffices. Offsets before the first heading
 * (document preamble) return `undefined`.
 */
export function findSectionTitle(offset: number, sections: readonly SectionSpan[]): string | undefined {
  for (const section of sections) {
    if (offset >= section.charStart && offset < section.charEnd) {
      return section.title;
    }
  }
  return undefined;
}
