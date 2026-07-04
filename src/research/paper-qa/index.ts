/**
 * PaperQA2-lite — Phase 1 provenance backbone.
 *
 * `PDF → StructuredDoc → Passage[]` with REAL page/section/offset provenance.
 * No LLM, no network. The index/embeddings (Phase 2) and the grounded answer
 * (Phase 3) build on the traceable passages produced here.
 */

export { parsePdfStructure, defaultParsePdf } from './pdf-structure.js';
export { chunkDocument } from './prose-chunker.js';
export { findPageNo, findSectionTitle } from './provenance.js';
export type {
  StructuredDoc,
  PageSpan,
  SectionSpan,
  Passage,
  ParsedPdf,
  ParsedPdfPage,
  PdfParseFn,
  PdfStructureDeps,
  ParsePdfStructureOptions,
  ChunkOptions,
} from './types.js';
