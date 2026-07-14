/**
 * PaperQA2-lite — structural PDF parser tests.
 *
 * The headline test parses a REAL, committed multi-page PDF fixture whose pages
 * have DELIBERATELY unequal lengths, proving the parser honours genuine page
 * boundaries instead of the uniform division used by the legacy PDF paths.
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePdfStructure } from '../../../src/research/paper-qa/pdf-structure.js';
import type { ParsedPdf, StructuredDoc } from '../../../src/research/paper-qa/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'sample-3page.pdf');

describe('parsePdfStructure — real fixture, real page boundaries', () => {
  it('parses the 3-page fixture with genuine (non-uniform) page boundaries', async () => {
    const doc = await parsePdfStructure(FIXTURE);
    expect(doc).not.toBeNull();
    const d = doc as StructuredDoc;

    // Three real pages.
    expect(d.pages).toHaveLength(3);
    expect(d.pages.map((p) => p.pageNo)).toEqual([1, 2, 3]);

    const [p1, p2, p3] = d.pages;

    // Real, DELIBERATELY UNEQUAL page lengths (56 / 331 / 90).
    // A uniform division of ~481 chars would put ~160 chars on each page —
    // this is the proof that boundaries are genuine, not fabricated.
    expect(p1!.text.length).toBeLessThan(100);
    expect(p2!.text.length).toBeGreaterThan(300);
    expect(p2!.text.length).toBeGreaterThan(p1!.text.length * 3);
    expect(p3!.text.length).toBeLessThan(p2!.text.length);

    // Each page holds ONLY its own marker — no bleed across the boundary.
    expect(p1!.text).toContain('ALPHA');
    expect(p1!.text).not.toContain('BETA');
    expect(p1!.text).not.toContain('GAMMA');

    expect(p2!.text).toContain('BETA');
    expect(p2!.text).toContain('Uniform division would never');
    expect(p2!.text).not.toContain('ALPHA');
    expect(p2!.text).not.toContain('GAMMA');

    expect(p3!.text).toContain('GAMMA');
    expect(p3!.text).not.toContain('ALPHA');
    expect(p3!.text).not.toContain('BETA');
  });

  it('keeps page offsets consistent with fullText (slice invariant)', async () => {
    const doc = await parsePdfStructure(FIXTURE);
    const d = doc as StructuredDoc;
    for (const page of d.pages) {
      expect(d.fullText.slice(page.charStart, page.charEnd)).toBe(page.text);
    }
    // Pages are ordered and non-overlapping.
    for (let i = 1; i < d.pages.length; i++) {
      expect(d.pages[i]!.charStart).toBeGreaterThanOrEqual(d.pages[i - 1]!.charEnd);
    }
  });

  it('detects the canonical sections on their real pages', async () => {
    const doc = await parsePdfStructure(FIXTURE);
    const d = doc as StructuredDoc;

    const byTitle = new Map(d.sections.map((s) => [s.title, s]));
    expect(byTitle.has('Introduction')).toBe(true);
    expect(byTitle.has('Methods')).toBe(true);
    expect(byTitle.has('Conclusion')).toBe(true);

    // Sections carry the page they actually start on.
    expect(byTitle.get('Introduction')!.pageNo).toBe(1);
    expect(byTitle.get('Methods')!.pageNo).toBe(2);
    expect(byTitle.get('Conclusion')!.pageNo).toBe(3);

    // Section offsets are consistent with fullText and start with the heading.
    for (const s of d.sections) {
      const slice = d.fullText.slice(s.charStart, s.charEnd);
      expect(slice.startsWith(s.title)).toBe(true);
      expect(s.charEnd).toBeGreaterThan(s.charStart);
    }
  });
});

// --- Deterministic section detection via injected pages (no real PDF) --------

function fakeParsedPdf(pages: string[], title?: string): ParsedPdf {
  const out: ParsedPdf = {
    pages: pages.map((text, i) => ({ num: i + 1, text })),
    total: pages.length,
  };
  if (title !== undefined) out.title = title;
  return out;
}

describe('parsePdfStructure — section heuristics (injected)', () => {
  it('detects numbered + canonical headings with correct offsets and pages', async () => {
    const page1 =
      'Abstract\nWe study provenance in scientific PDFs and how to preserve it.\n' +
      '1. Introduction\nProvenance is the ability to trace a claim back to a page.';
    const page2 =
      '2. Methods\nWe parse real page boundaries from pdf-parse output.\n' +
      '2.1 Chunking\nProse is split on sentence boundaries with overlap.\n' +
      'Results\nThe offsets stay consistent across pages and sections.';

    const doc = await parsePdfStructure(
      '/virtual/paper.pdf',
      {
        readFile: async () => Buffer.from('%PDF-1.4 fake'),
        parsePdf: async () => fakeParsedPdf([page1, page2], 'A Provenance Study'),
      },
    );
    expect(doc).not.toBeNull();
    const d = doc as StructuredDoc;

    expect(d.title).toBe('A Provenance Study');
    expect(d.pages).toHaveLength(2);

    const titles = d.sections.map((s) => s.title);
    expect(titles).toContain('Abstract');
    expect(titles).toContain('1. Introduction');
    expect(titles).toContain('2. Methods');
    expect(titles).toContain('2.1 Chunking');
    expect(titles).toContain('Results');

    // "2.1 Chunking" is a level-2 numbered heading.
    const chunking = d.sections.find((s) => s.title === '2.1 Chunking')!;
    expect(chunking.level).toBe(2);

    // Section on page 2 is attributed to page 2.
    const methods = d.sections.find((s) => s.title === '2. Methods')!;
    expect(methods.pageNo).toBe(2);

    // Offset invariant for every section.
    for (const s of d.sections) {
      expect(d.fullText.slice(s.charStart, s.charEnd).startsWith(s.title)).toBe(true);
    }

    // Page slice invariant holds under injection too.
    for (const p of d.pages) {
      expect(d.fullText.slice(p.charStart, p.charEnd)).toBe(p.text);
    }
  });

  it('detects a short canonical heading regardless of the following line (finding D1)', async () => {
    // "Methods" is a canonical marker, so it must be a heading even when the next
    // line is short (<40 chars) — where the Title-Case lead-in heuristic bails.
    const page = 'Methods\nShort.\nA slightly longer following sentence of body prose here.';
    const doc = await parsePdfStructure('/virtual/short-heading.pdf', {
      readFile: async () => Buffer.from('x'),
      parsePdf: async () => fakeParsedPdf([page]),
    });
    expect((doc as StructuredDoc).sections.map((s) => s.title)).toContain('Methods');
  });

  it('rejects a sentence that merely opens with a number; keeps real numbered headings (finding D2)', async () => {
    const page =
      'Results\n2020 was a record year for solar output across the whole region\n' +
      '3.2 System Design\nWe describe the apparatus and the pipeline used in the study.';
    const doc = await parsePdfStructure('/virtual/numbered.pdf', {
      readFile: async () => Buffer.from('x'),
      parsePdf: async () => fakeParsedPdf([page]),
    });
    const titles = (doc as StructuredDoc).sections.map((s) => s.title);
    expect(titles).toContain('Results');
    // A genuine numbered heading (title-cased remainder) survives.
    expect(titles).toContain('3.2 System Design');
    // The number-led sentence is NOT promoted to a phantom heading.
    expect(titles.some((t) => t.startsWith('2020'))).toBe(false);
  });

  it('returns a valid doc with empty sections when nothing looks like a heading', async () => {
    const prose =
      'this is a single run of lowercase prose with no headings at all and it just keeps going as one long paragraph without any structural markers whatsoever.';
    const doc = await parsePdfStructure('/virtual/plain.pdf', {
      readFile: async () => Buffer.from('x'),
      parsePdf: async () => fakeParsedPdf([prose]),
    });
    const d = doc as StructuredDoc;
    expect(d).not.toBeNull();
    expect(d.pages).toHaveLength(1);
    expect(d.sections).toEqual([]);
    expect(d.fullText).toBe(prose);
  });

  it('respects the maxPages cap', async () => {
    const pages = Array.from({ length: 10 }, (_, i) => `Page number ${i + 1} content.`);
    const doc = await parsePdfStructure('/virtual/big.pdf', {
      readFile: async () => Buffer.from('x'),
      parsePdf: async () => fakeParsedPdf(pages),
    }, { maxPages: 4 });
    expect((doc as StructuredDoc).pages).toHaveLength(4);
  });
});

// --- Graceful degradation ----------------------------------------------------

describe('parsePdfStructure — never-throws degradation', () => {
  it('returns null when pdf-parse yields no result', async () => {
    const doc = await parsePdfStructure('/virtual/x.pdf', {
      readFile: async () => Buffer.from('x'),
      parsePdf: async () => null,
    });
    expect(doc).toBeNull();
  });

  it('returns null when pdf-parse yields zero pages', async () => {
    const doc = await parsePdfStructure('/virtual/x.pdf', {
      readFile: async () => Buffer.from('x'),
      parsePdf: async () => ({ pages: [], total: 0 }),
    });
    expect(doc).toBeNull();
  });

  it('returns null when the file cannot be read', async () => {
    const doc = await parsePdfStructure('/virtual/missing.pdf', {
      readFile: async () => {
        throw new Error('ENOENT');
      },
    });
    expect(doc).toBeNull();
  });

  it('returns null (never throws) when the parser itself throws', async () => {
    const doc = await parsePdfStructure('/virtual/x.pdf', {
      readFile: async () => Buffer.from('x'),
      parsePdf: async () => {
        throw new Error('boom');
      },
    });
    expect(doc).toBeNull();
  });
});

describe('parsePdfStructure — scanned-page OCR fallback', () => {
  it('OCRs only nearly-empty pages and preserves native page provenance', async () => {
    const calls: Array<{ pages: number[]; language: string }> = [];
    const doc = await parsePdfStructure(
      '/virtual/scanned.pdf',
      {
        readFile: async () => Buffer.from('pdf'),
        parsePdf: async () => fakeParsedPdf(['', 'Methods\nNative searchable prose remains intact on page two.']),
        ocrPdf: async (_data, pages, language) => {
          calls.push({ pages, language });
          return [{ num: 1, text: 'Introduction\nText recovered from the scanned first page.' }];
        },
      },
      { ocrLanguage: 'eng+fra' },
    );

    expect(calls).toEqual([{ pages: [1], language: 'eng+fra' }]);
    expect(doc?.pages.map((page) => page.text)).toEqual([
      'Introduction\nText recovered from the scanned first page.',
      'Methods\nNative searchable prose remains intact on page two.',
    ]);
    expect(doc?.pages[0]?.pageNo).toBe(1);
    expect(doc?.fullText.slice(doc.pages[0]!.charStart, doc.pages[0]!.charEnd)).toBe(
      doc.pages[0]!.text,
    );
  });

  it('bounds OCR page count and can be disabled explicitly', async () => {
    const requested: number[][] = [];
    const deps = {
      readFile: async () => Buffer.from('pdf'),
      parsePdf: async () => fakeParsedPdf(['', '', '', 'Native text that keeps this document readable.']),
      ocrPdf: async (_data: Uint8Array, pages: number[]) => {
        requested.push(pages);
        return pages.map((num) => ({ num, text: `OCR page ${num} with enough recovered prose.` }));
      },
    };

    const bounded = await parsePdfStructure('/virtual/bounded-scan.pdf', deps, { maxOcrPages: 2 });
    expect(requested).toEqual([[1, 2]]);
    expect(bounded?.pages[2]?.text).toBe('');

    requested.length = 0;
    await parsePdfStructure('/virtual/disabled-scan.pdf', deps, { ocr: false });
    expect(requested).toEqual([]);
  });

  it('returns null without throwing when OCR fails on a textless PDF', async () => {
    const warnings: string[] = [];
    const doc = await parsePdfStructure('/virtual/broken-scan.pdf', {
      readFile: async () => Buffer.from('pdf'),
      parsePdf: async () => fakeParsedPdf(['']),
      ocrPdf: async () => {
        throw new Error('OCR engine unavailable');
      },
      warn: (message) => warnings.push(message),
    });

    expect(doc).toBeNull();
    expect(warnings).toContain('paper-qa: scanned-page OCR unavailable');
    expect(warnings).toContain('paper-qa: PDF has no extractable text after OCR fallback');
  });
});
