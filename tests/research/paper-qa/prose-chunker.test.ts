/**
 * PaperQA2-lite — prose chunker tests.
 *
 * Proves that passages carry provenance DERIVED from the doc's real page/section
 * offsets (not fabricated), that the slice invariant holds, that overlap and the
 * passage cap behave, and that degenerate input degrades to `[]`.
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chunkDocument } from '../../../src/research/paper-qa/prose-chunker.js';
import { parsePdfStructure } from '../../../src/research/paper-qa/pdf-structure.js';
import type { ParsedPdf, StructuredDoc } from '../../../src/research/paper-qa/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'sample-3page.pdf');

/** Build a real StructuredDoc through the parser with injected pages. */
async function docFromPages(pages: string[]): Promise<StructuredDoc> {
  const parsed: ParsedPdf = {
    pages: pages.map((text, i) => ({ num: i + 1, text })),
    total: pages.length,
  };
  const doc = await parsePdfStructure('/virtual/doc.pdf', {
    readFile: async () => Buffer.from('x'),
    parsePdf: async () => parsed,
  });
  return doc as StructuredDoc;
}

describe('chunkDocument — provenance and invariants', () => {
  it('produces passages whose text equals their fullText slice', async () => {
    const doc = await docFromPages([
      'Introduction\nProvenance lets a reader trace a claim back to its exact page. ' +
        'This first page contains several sentences of prose to chunk. ' +
        'Each sentence adds a little more length to the page body.',
      'Methods\nWe extract real page boundaries from the parser output. ' +
        'Then we split prose on sentence boundaries with a small overlap. ' +
        'Every passage keeps an absolute character range into the document.',
    ]);

    const passages = chunkDocument(doc, { targetChars: 120, overlapChars: 30 });
    expect(passages.length).toBeGreaterThan(1);

    for (const p of passages) {
      // The load-bearing invariant: passage text is exactly its offset slice.
      expect(doc.fullText.slice(p.charStart, p.charEnd)).toBe(p.text);
      expect(p.charEnd).toBeGreaterThan(p.charStart);
      expect(p.docId).toBe(doc.docId);
    }

    // Indices are sequential from 0.
    expect(passages.map((p) => p.index)).toEqual(passages.map((_, i) => i));
  });

  it('derives page and section provenance from the offsets', async () => {
    const doc = await docFromPages([
      'Introduction\nThe introduction spans the first page with enough prose to yield its own passages here.',
      'Methods\nThe methods section lives entirely on the second page and also has enough prose for passages.',
    ]);

    const passages = chunkDocument(doc, { targetChars: 80, overlapChars: 0 });

    // Every passage that begins on page 1 must fall under Introduction; page 2 → Methods.
    for (const p of passages) {
      if (p.page === 1) {
        expect(p.section).toBe('Introduction');
      } else if (p.page === 2) {
        expect(p.section).toBe('Methods');
      }
    }

    // Both pages are represented.
    const pagesSeen = new Set(passages.map((p) => p.page));
    expect(pagesSeen.has(1)).toBe(true);
    expect(pagesSeen.has(2)).toBe(true);

    // And both sections are represented.
    const sectionsSeen = new Set(passages.map((p) => p.section));
    expect(sectionsSeen.has('Introduction')).toBe(true);
    expect(sectionsSeen.has('Methods')).toBe(true);
  });

  it('creates overlap between adjacent passages when requested', async () => {
    const sentences = Array.from(
      { length: 30 },
      (_, i) => `Sentence number ${i + 1} carries a little bit of prose.`,
    ).join(' ');
    const doc = await docFromPages([sentences]);

    const withOverlap = chunkDocument(doc, { targetChars: 120, overlapChars: 50 });
    expect(withOverlap.length).toBeGreaterThan(2);

    // At least one adjacent pair genuinely overlaps (next starts before prev ends).
    let overlaps = 0;
    for (let i = 1; i < withOverlap.length; i++) {
      if (withOverlap[i]!.charStart < withOverlap[i - 1]!.charEnd) overlaps++;
    }
    expect(overlaps).toBeGreaterThan(0);

    // With no overlap, adjacent passages never overlap.
    const noOverlap = chunkDocument(doc, { targetChars: 120, overlapChars: 0 });
    for (let i = 1; i < noOverlap.length; i++) {
      expect(noOverlap[i]!.charStart).toBeGreaterThanOrEqual(noOverlap[i - 1]!.charEnd);
    }
  });

  it('respects the maxPassages cap', async () => {
    const big = Array.from(
      { length: 200 },
      (_, i) => `This is filler sentence ${i + 1} used to force many passages.`,
    ).join(' ');
    const doc = await docFromPages([big]);

    const capped = chunkDocument(doc, { targetChars: 60, overlapChars: 0, maxPassages: 3 });
    expect(capped.length).toBeLessThanOrEqual(3);
  });

  it('keeps passages near the target size (prose-oriented, not line-based)', async () => {
    const doc = await docFromPages([
      Array.from({ length: 40 }, (_, i) => `Alpha beta gamma delta epsilon ${i}.`).join(' '),
    ]);
    const passages = chunkDocument(doc, { targetChars: 200, overlapChars: 0 });
    expect(passages.length).toBeGreaterThan(1);
    // No passage is absurdly larger than target + one trailing sentence.
    for (const p of passages) {
      expect(p.text.length).toBeLessThan(400);
    }
  });
});

describe('chunkDocument — end-to-end from the real fixture', () => {
  it('chunks the real 3-page PDF with correct page provenance', async () => {
    const doc = (await parsePdfStructure(FIXTURE)) as StructuredDoc;
    const passages = chunkDocument(doc, { targetChars: 40, overlapChars: 0 });

    expect(passages.length).toBeGreaterThan(0);
    for (const p of passages) {
      expect(doc.fullText.slice(p.charStart, p.charEnd)).toBe(p.text);
      expect(p.page).toBeGreaterThanOrEqual(1);
      expect(p.page).toBeLessThanOrEqual(3);
    }

    // The ALPHA/BETA/GAMMA markers land on their real pages.
    const alpha = passages.find((p) => p.text.includes('ALPHA'));
    const beta = passages.find((p) => p.text.includes('BETA'));
    const gamma = passages.find((p) => p.text.includes('GAMMA'));
    expect(alpha?.page).toBe(1);
    expect(beta?.page).toBe(2);
    expect(gamma?.page).toBe(3);
  });
});

describe('chunkDocument — degradation', () => {
  it('returns [] for an empty document', () => {
    const empty: StructuredDoc = { docId: 'x', pages: [], sections: [], fullText: '' };
    expect(chunkDocument(empty)).toEqual([]);
  });

  it('returns [] for a doc with whitespace-only text', () => {
    const ws: StructuredDoc = {
      docId: 'x',
      pages: [{ pageNo: 1, text: '   \n\n  ', charStart: 0, charEnd: 7 }],
      sections: [],
      fullText: '   \n\n  ',
    };
    expect(chunkDocument(ws)).toEqual([]);
  });
});
