import * as fs from 'fs';
import * as path from 'path';
import type { FileAttachmentContent } from '../../renderer/types';
import { loadCoreModule } from '../utils/core-loader';
import { logWarn } from '../utils/logger';

const MAX_ATTACHMENT_EXCERPT_CHARS = 12_000;

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.csv',
  '.tsv',
  '.log',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.sql',
]);

const DOCUMENT_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx', '.rtf']);
const WORKSHOP_DOCUMENT_EXTENSIONS = new Set(['.docx', '.pdf']);
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.mov',
  '.mkv',
  '.avi',
  '.m4v',
  '.mpeg',
  '.mpg',
]);

interface CoreDocumentModule {
  DocumentTool: new () => {
    readDocument: (
      filePath: string
    ) => Promise<{
      success: boolean;
      output?: string;
      error?: string;
      data?: { text?: string };
    }>;
  };
}

interface CorePdfModule {
  PDFTool: new () => {
    extractText: (
      filePath: string,
      options?: { pages?: number[]; maxPages?: number }
    ) => Promise<{
      success: boolean;
      output?: string;
      error?: string;
      data?: { text?: string };
    }>;
  };
}

export function formatFileAttachmentPromptLine(
  file: Pick<FileAttachmentContent, 'filename' | 'relativePath' | 'size' | 'mimeType'>
): string {
  const sizeKb = (Math.max(0, file.size) / 1024).toFixed(1);
  const mimeInfo = file.mimeType ? `, type: ${file.mimeType}` : '';
  return `- ${file.filename} (${sizeKb} KB${mimeInfo}) at path: ${file.relativePath}`;
}

export function resolveAttachmentPath(cwd: string | undefined, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(cwd || process.cwd(), filePath);
}

function truncateExcerpt(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= MAX_ATTACHMENT_EXCERPT_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_ATTACHMENT_EXCERPT_CHARS)}\n...`;
}

function extensionOf(file: Pick<FileAttachmentContent, 'filename' | 'relativePath'>): string {
  return path.extname(file.filename || file.relativePath).toLowerCase();
}

function normalizePromptPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function normalizeIntentText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function hasWorkshopIntent(prompt: string): boolean {
  const normalized = normalizeIntentText(prompt);
  return [
    'question',
    'questions',
    'repond',
    'answer',
    'answers',
    'livrable',
    'deliverable',
    'analyse fonctionnelle',
    'functional analysis',
    'document de travail',
    'workshop',
    'atelier',
  ].some((term) => normalized.includes(term));
}

function isTextAttachment(
  file: Pick<FileAttachmentContent, 'filename' | 'relativePath' | 'mimeType'>
): boolean {
  if (file.mimeType?.startsWith('text/')) return true;
  return TEXT_EXTENSIONS.has(extensionOf(file));
}

function isDocumentAttachment(
  file: Pick<FileAttachmentContent, 'filename' | 'relativePath' | 'mimeType'>
): boolean {
  if (file.mimeType?.includes('wordprocessingml')) return true;
  if (file.mimeType?.includes('spreadsheetml')) return true;
  if (file.mimeType?.includes('presentationml')) return true;
  if (file.mimeType === 'application/msword') return false;
  return DOCUMENT_EXTENSIONS.has(extensionOf(file));
}

function isPdfAttachment(
  file: Pick<FileAttachmentContent, 'filename' | 'relativePath' | 'mimeType'>
): boolean {
  return file.mimeType === 'application/pdf' || extensionOf(file) === '.pdf';
}

function isVideoAttachment(
  file: Pick<FileAttachmentContent, 'filename' | 'relativePath' | 'mimeType'>
): boolean {
  if (file.mimeType?.startsWith('video/')) return true;
  return VIDEO_EXTENSIONS.has(extensionOf(file));
}

/**
 * Routes an attached video to the core `understand_video` tool.
 *
 * A video is inert to the text/document extraction path (it has no readable
 * excerpt), so instead of ignoring it we inject a clear instruction that steers
 * the agent to call the `understand_video` tool with the file path as its
 * source. The agent invokes the tool itself through the existing agentic loop —
 * the least-invasive, most robust route (no direct tool call from the main
 * process, so no extra coupling to the core tool surface).
 */
export function buildVideoUnderstandingGuidance(
  files: Array<Pick<FileAttachmentContent, 'filename' | 'relativePath' | 'mimeType'>>
): string | null {
  const videos = files.filter(isVideoAttachment);
  if (videos.length === 0) return null;

  const lines = videos.map((file) => {
    const sourcePath = normalizePromptPath(file.relativePath || file.filename);
    return `- A video was provided: ${sourcePath}. Use the understand_video tool with source ${sourcePath} to understand it before answering.`;
  });

  return [
    '[Video understanding guidance]',
    '- One or more videos were attached. Do NOT try to Read them directly or treat them as plain text — they have no readable text excerpt.',
    '- Call the understand_video tool with the video file path as its `source` to produce a transcript, then answer from that transcript.',
    '- Pass the user question through as the understand_video `question` argument when it is about the video content.',
    ...lines,
  ].join('\n');
}

export function shouldIncludeDocumentWorkshopGuidance(
  prompt: string,
  files: Array<Pick<FileAttachmentContent, 'filename' | 'relativePath' | 'mimeType'>>
): boolean {
  if (!hasWorkshopIntent(prompt)) return false;
  return files.some((file) => {
    const ext = extensionOf(file);
    return (
      WORKSHOP_DOCUMENT_EXTENSIONS.has(ext) ||
      file.mimeType === 'application/pdf' ||
      Boolean(file.mimeType?.includes('wordprocessingml'))
    );
  });
}

export function buildAttachmentOnlyPrompt(
  files: Array<Pick<FileAttachmentContent, 'filename' | 'relativePath' | 'mimeType'>>
): string | null {
  if (files.length === 0) return null;

  const names = files
    .map((file) => file.filename || path.basename(file.relativePath))
    .filter(Boolean)
    .join(', ');
  const target = names || 'the attached file(s)';
  const hasWorkshopDocument = files.some((file) => {
    const ext = extensionOf(file);
    return (
      WORKSHOP_DOCUMENT_EXTENSIONS.has(ext) ||
      file.mimeType === 'application/pdf' ||
      Boolean(file.mimeType?.includes('wordprocessingml'))
    );
  });

  if (hasWorkshopDocument) {
    return `Analyze the attached document(s): ${target}. If they contain questions or functional-analysis context, identify every question, answer one by one, preserve screenshot/table context, and generate a DOCX deliverable when useful.`;
  }

  if (files.some(isVideoAttachment)) {
    return `Understand the attached video(s): ${target}. Use the understand_video tool with each video path as its source to transcribe and analyze the content, then answer.`;
  }

  return `Analyze the attached file(s): ${target}.`;
}

function buildDocumentWorkshopGuidance(): string {
  return [
    '[Document workshop guidance]',
    '- Treat the attached source document as the authority.',
    '- Identify every question before answering; preserve the surrounding functional-analysis context when it changes the answer.',
    '- Include in the final deliverable the functional-analysis context that appears before each question, especially screenshots, tables, and explanatory paragraphs that frame the question.',
    '- Maintain a compact question-context registry with columns: Question id, source context, screenshot/OCR reference, answer status; reuse it in the final deliverable.',
    '- Treat table rows and [Embedded image: ...] markers in excerpts as functional-analysis context; mention when a screenshot is relevant but not text-readable.',
    '- Suggested source-analysis tool sequence: for DOCX, run document read, then document extract_images with an output_dir next to the source when screenshots are present, then ocr batch on extracted image paths before final answers.',
    '- For PDF, run pdf extract with max_pages first. If extractable text is minimal or the PDF is screenshot-heavy, use pdf to_base64 with a vision-capable model or any available OCR/rendering path before final answers.',
    '- Prefer the [Document workshop path hints] below for source-specific read/extract commands and generate_document output_path unless the user requested another destination.',
    '- Emit short progress markers when the work is done: "Contexte fonctionnel capture" after mapping the functional-analysis context, "Questions extraites" after the question inventory, "OCR termine" after screenshot OCR, and "Reponses preparees" after drafting the question-by-question answers.',
    '- Emit "Traceabilite atelier complete" when the question/context/OCR/answer links are ready for the final deliverable.',
    '- When OCR text clarifies a screenshot, bind that OCR summary to the nearby question and keep the extracted image markdownRef for the final deliverable.',
    '- Answer questions one by one, cite the source section, nearby excerpt or OCR summary when possible, and mark uncertainty instead of inventing missing details. Include OCR-backed screenshot references in the deliverable by reusing extract_images markdownRef values when useful.',
    '- Expected answer structure for each question: Synthese courte, Explication detaillee, Preuves from code/source evidence, Mermaid diagram when a flow or dependency is involved, Impacts/limits/attention points, Sources.',
    '- Rendering rules: Mermaid edges need explicit labels; write technical values `true`, `false`, and `null` as inline code; do not use `<true>`, `<false>`, `<null>`, or empty Mermaid edges.',
    '- Keep quality checks internal: do not add visible numeric quality scores such as "Score qualite 0/100" to the final deliverable.',
    '- Before presenting the final DOCX as ready, validate Word compatibility signals: package relationships, embedded media count, and the generated .docx output path.',
    '- If asked for a deliverable, prepare a technical document structure and use generate_document with type docx plus a matching .docx output path.',
  ].join('\n');
}

function buildDocumentWorkshopPathHints(
  files: Array<Pick<FileAttachmentContent, 'filename' | 'relativePath' | 'mimeType'>>
): string | null {
  const lines = files
    .filter((file) => isPdfAttachment(file) || isDocumentAttachment(file))
    .map((file) => {
      const sourcePath = file.relativePath || file.filename;
      const ext = path.extname(sourcePath);
      const stem = path.basename(sourcePath, ext) || path.basename(file.filename, extensionOf(file));
      const sourceDir = path.dirname(sourcePath);
      const outputDir = normalizePromptPath(path.join(sourceDir, `${stem}-images`));
      const outputPath = normalizePromptPath(path.join(sourceDir, `${stem}-livrable.docx`));
      if (isPdfAttachment(file)) {
        return `- ${file.filename}: pdf extract path ${normalizePromptPath(sourcePath)} max_pages 20; if text is minimal, pdf to_base64 for vision/OCR review; generate_document output_path ${outputPath}`;
      }
      return `- ${file.filename}: document extract_images output_dir ${outputDir}; generate_document output_path ${outputPath}`;
    });

  if (lines.length === 0) return null;
  return ['[Document workshop path hints]', ...lines].join('\n');
}

async function extractDocumentText(filePath: string): Promise<string | null> {
  const module = await loadCoreModule<CoreDocumentModule>('tools/document-tool.js');
  if (!module) return null;
  const result = await new module.DocumentTool().readDocument(filePath);
  if (!result.success) return null;
  return result.data?.text ?? result.output ?? null;
}

async function extractPdfText(filePath: string): Promise<string | null> {
  const module = await loadCoreModule<CorePdfModule>('tools/pdf-tool.js');
  if (!module) return null;
  const result = await new module.PDFTool().extractText(filePath, { maxPages: 20 });
  if (!result.success) return null;
  return result.data?.text ?? result.output ?? null;
}

function readTextFileExcerpt(filePath: string): string | null {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(MAX_ATTACHMENT_EXCERPT_CHARS);
    const bytesRead = fs.readSync(fd, buffer, 0, MAX_ATTACHMENT_EXCERPT_CHARS, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

export async function extractAttachmentTextExcerpt(
  file: Pick<FileAttachmentContent, 'filename' | 'relativePath' | 'mimeType'>,
  cwd?: string
): Promise<string | null> {
  const absolutePath = resolveAttachmentPath(cwd, file.relativePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  try {
    if (isDocumentAttachment(file)) {
      const text = await extractDocumentText(absolutePath);
      return text ? truncateExcerpt(text) : null;
    }
    if (isPdfAttachment(file)) {
      const text = await extractPdfText(absolutePath);
      return text ? truncateExcerpt(text) : null;
    }
    if (isTextAttachment(file)) {
      const text = readTextFileExcerpt(absolutePath);
      return text ? truncateExcerpt(text) : null;
    }
  } catch (err) {
    logWarn('[SessionManager] attachment text extraction failed:', err);
  }

  return null;
}

export async function buildAttachedFilesPromptContext(
  files: FileAttachmentContent[],
  cwd?: string,
  prompt: string = ''
): Promise<string> {
  const fileInfo = files.map(formatFileAttachmentPromptLine).join('\n');
  const excerpts: string[] = [];

  for (const file of files) {
    const excerpt = await extractAttachmentTextExcerpt(file, cwd);
    if (excerpt) {
      excerpts.push(`### ${file.filename}\n${excerpt}`);
    }
  }

  const sections = [`[Attached files - use Read tool to access them]:\n${fileInfo}`];

  const videoGuidance = buildVideoUnderstandingGuidance(files);
  if (videoGuidance) {
    sections.push(videoGuidance);
  }

  if (shouldIncludeDocumentWorkshopGuidance(prompt, files)) {
    sections.push(buildDocumentWorkshopGuidance());
    const pathHints = buildDocumentWorkshopPathHints(files);
    if (pathHints) {
      sections.push(pathHints);
    }
  }

  if (excerpts.length > 0) {
    sections.push(
      `[Attached file text excerpts - verify against source before final answers]:\n${excerpts.join('\n\n')}`
    );
  }

  return sections.join('\n\n');
}
