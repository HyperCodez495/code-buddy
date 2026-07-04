/**
 * PaperQA2-lite — Phase 1 provenance types.
 *
 * The provenance backbone: a PDF is parsed into a {@link StructuredDoc} whose
 * pages and sections carry REAL character offsets into a single `fullText`, and
 * the prose chunker derives each {@link Passage}'s page/section/offset provenance
 * from those spans. This is the link (page + section + exact char range) that the
 * two existing PDF paths fabricate today via uniform division.
 *
 * No LLM, no network. Pure, injectable, never-throws.
 */

/** A single physical PDF page mapped onto `StructuredDoc.fullText`. */
export interface PageSpan {
  /** 1-based physical page number as reported by the parser. */
  pageNo: number;
  /** Exact page text. Invariant: `fullText.slice(charStart, charEnd) === text`. */
  text: string;
  /** Absolute start offset of this page inside `fullText` (inclusive). */
  charStart: number;
  /** Absolute end offset of this page inside `fullText` (exclusive). */
  charEnd: number;
}

/** A detected document section (heading + the text that follows it). */
export interface SectionSpan {
  /** Heading text (trimmed, trailing colon stripped). */
  title: string;
  /** Nesting level: 1 = top level; deeper numbered headings get higher values. */
  level: number;
  /** 1-based page on which the section heading begins. */
  pageNo: number;
  /** Absolute start offset of the section (its heading) inside `fullText`. */
  charStart: number;
  /** Absolute end offset of the section (start of the next heading, or EOF). */
  charEnd: number;
}

/** A parsed PDF with real, offset-based page and section provenance. */
export interface StructuredDoc {
  /** Stable id derived from the source path (or caller-supplied). */
  docId: string;
  /** Document title, best-effort from PDF metadata. */
  title?: string;
  /** Physical pages with real boundaries (never uniform division). */
  pages: PageSpan[];
  /** Best-effort detected sections. Empty when none can be detected. */
  sections: SectionSpan[];
  /** The concatenated document text that all offsets index into. */
  fullText: string;
}

/** A traceable prose passage with provenance derived from the doc's spans. */
export interface Passage {
  /** Owning document id. */
  docId: string;
  /** 1-based page on which the passage begins. */
  page: number;
  /** Section title the passage falls under, if any. */
  section?: string;
  /** Absolute start offset inside `StructuredDoc.fullText` (inclusive). */
  charStart: number;
  /** Absolute end offset inside `StructuredDoc.fullText` (exclusive). */
  charEnd: number;
  /** Passage text. Invariant: `fullText.slice(charStart, charEnd) === text`. */
  text: string;
  /** 0-based passage index within the document. */
  index: number;
}

/** One page as produced by the injectable pdf-parse boundary. */
export interface ParsedPdfPage {
  /** 1-based physical page number. */
  num: number;
  /** Real text of this page (NOT a uniform slice). */
  text: string;
}

/** Result of the injectable pdf-parse boundary. */
export interface ParsedPdf {
  /** Per-page text in page order. */
  pages: ParsedPdfPage[];
  /** Total page count reported by the parser. */
  total: number;
  /** Optional document title from PDF metadata. */
  title?: string;
}

/**
 * Injectable PDF-parsing boundary. Returns real per-page text, or `null` when
 * the document is unreadable/absent/encrypted (never throws). The default
 * implementation wraps `pdf-parse` v2; tests inject a deterministic fake.
 */
export type PdfParseFn = (data: Uint8Array) => Promise<ParsedPdf | null>;

/** Injectable side-effect boundaries for {@link parsePdfStructure}. */
export interface PdfStructureDeps {
  /** Override the pdf-parse access (default: dynamic `pdf-parse` import). */
  parsePdf?: PdfParseFn;
  /** Override file reading (default: `fs/promises` readFile). */
  readFile?: (path: string) => Promise<Buffer>;
  /** Override warning sink (default: project logger). */
  warn?: (message: string, context?: Record<string, unknown>) => void;
}

/** Bounded knobs for {@link parsePdfStructure}. */
export interface ParsePdfStructureOptions {
  /** Hard cap on pages processed (default 5000). */
  maxPages?: number;
  /** Hard cap on detected sections (default 1000). */
  maxSections?: number;
  /** Override the derived docId. */
  docId?: string;
}

/** Bounded knobs for {@link chunkDocument}. */
export interface ChunkOptions {
  /** Target passage size in characters (default 1000, clamped 50..100000). */
  targetChars?: number;
  /** Overlap between adjacent passages in characters (default 150). */
  overlapChars?: number;
  /** Hard cap on the number of passages (default 5000). */
  maxPassages?: number;
}
