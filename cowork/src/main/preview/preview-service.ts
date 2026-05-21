/**
 * PreviewService — Claude Cowork parity Phase 2 step 9
 *
 * Provides on-demand file previews for the FilePreviewPane UI.
 * Detects MIME by extension and returns one of these payload kinds:
 *   - text:    plain text + line count for code/markdown/config files
 *   - image:   base64 data URI inline (capped at 5MB)
 *   - pdf:     extracted text via core PDFTool (lazy loaded)
 *   - document: extracted Office/CSV text via core DocumentTool (lazy loaded)
 *   - binary:  metadata only (size, mime), no content
 *
 * Used by IPC handler `preview.get(path)` to power FilePreviewPane.
 *
 * @module main/preview/preview-service
 */

import * as fs from 'fs';
import * as path from 'path';
import { log, logWarn } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';

export type PreviewKind = 'text' | 'image' | 'pdf' | 'document' | 'binary' | 'error';

export interface PreviewResult {
  kind: PreviewKind;
  path: string;
  name: string;
  size: number;
  mime: string;
  /** Text content for code/markdown previews */
  text?: string;
  /** Number of text lines */
  lineCount?: number;
  /** Detected language hint for syntax highlighting */
  language?: string;
  /** Base64 data URI for images */
  dataUri?: string;
  /** Image dimensions if known */
  dimensions?: { width: number; height: number };
  /** Extracted text for PDF previews */
  pdfText?: string;
  /** Number of pages for PDF previews */
  pdfPages?: number;
  /** Extracted Office/CSV text for document previews */
  documentText?: string;
  /** Normalized document type from the extractor (docx/xlsx/pptx/csv/rtf) */
  documentType?: string;
  /** Lightweight document counts surfaced in the header */
  documentStats?: {
    wordCount?: number;
    embeddedImageCount?: number;
    sheetCount?: number;
    slideCount?: number;
  };
  /** Error message when kind === 'error' */
  error?: string;
}

const MAX_TEXT_BYTES = 2 * 1024 * 1024; // 2 MB cap for text previews
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB cap for inlined images
const MAX_DOCUMENT_TEXT_CHARS = 200_000; // cap extracted Office text in the preview pane

const TEXT_EXTENSIONS = new Set<string>([
  '.txt', '.md', '.markdown', '.rst', '.adoc', '.org',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.env', '.properties', '.gitignore', '.gitattributes', '.editorconfig',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cs', '.m', '.mm',
  '.php', '.lua', '.pl', '.r', '.jl', '.dart',
  '.html', '.htm', '.xml', '.svg', '.css', '.scss', '.less', '.sass',
  '.sql', '.graphql', '.proto',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.dockerfile', '.makefile', '.cmake',
  '.tex', '.bib',
  '.csv', '.tsv', '.log',
  '.nix', '.tf', '.hcl', '.dhall',
]);

const IMAGE_EXTENSIONS = new Set<string>([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif',
]);

const DOCUMENT_EXTENSIONS = new Set<string>([
  '.docx', '.xlsx', '.pptx', '.rtf',
]);

const SVG_AS_IMAGE_TOO = true; // SVG is also previewable as text

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'tsx',
  '.js': 'javascript', '.jsx': 'jsx', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
  '.java': 'java', '.kt': 'kotlin', '.scala': 'scala', '.swift': 'swift',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp',
  '.cs': 'csharp', '.php': 'php', '.lua': 'lua', '.pl': 'perl',
  '.r': 'r', '.jl': 'julia', '.dart': 'dart',
  '.html': 'html', '.htm': 'html', '.xml': 'xml',
  '.css': 'css', '.scss': 'scss', '.less': 'less', '.sass': 'sass',
  '.json': 'json', '.jsonc': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'toml', '.ini': 'ini',
  '.md': 'markdown', '.markdown': 'markdown',
  '.sql': 'sql', '.graphql': 'graphql', '.proto': 'protobuf',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'fish',
  '.ps1': 'powershell', '.bat': 'batch', '.cmd': 'batch',
  '.dockerfile': 'dockerfile',
  '.tex': 'latex',
  '.nix': 'nix', '.tf': 'hcl', '.hcl': 'hcl',
  '.svg': 'xml',
};

const MIME_MAP: Record<string, string> = {
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
  '.tsv': 'text/tab-separated-values',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
};

export function detectPreviewMime(ext: string): string {
  if (MIME_MAP[ext]) return MIME_MAP[ext];
  if (TEXT_EXTENSIONS.has(ext)) return 'text/plain';
  return 'application/octet-stream';
}

function detectLanguage(ext: string): string | undefined {
  return LANGUAGE_MAP[ext];
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
      data?: { text: string; pageCount: number };
    }>;
  };
}

interface CoreDocumentModule {
  DocumentTool: new () => {
    readDocument: (
      filePath: string
    ) => Promise<{
      success: boolean;
      output?: string;
      error?: string;
      data?: {
        text: string;
        type: string;
        metadata?: {
          wordCount?: number;
          embeddedImageCount?: number;
          sheetCount?: number;
          slideCount?: number;
        };
      };
    }>;
  };
}

export class PreviewService {
  private pdfModule: CorePdfModule | null = null;
  private documentModule: CoreDocumentModule | null = null;

  async getPreview(filePath: string): Promise<PreviewResult> {
    const name = path.basename(filePath);
    try {
      if (!fs.existsSync(filePath)) {
        return {
          kind: 'error',
          path: filePath,
          name,
          size: 0,
          mime: 'application/octet-stream',
          error: 'File not found',
        };
      }

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        return {
          kind: 'error',
          path: filePath,
          name,
          size: 0,
          mime: 'inode/directory',
          error: 'Path is a directory',
        };
      }

      const ext = path.extname(filePath).toLowerCase();
      const mime = detectPreviewMime(ext);
      const size = stat.size;

      // PDF preview
      if (ext === '.pdf') {
        return await this.getPdfPreview(filePath, name, size, mime);
      }

      // Office/CSV document preview via core DocumentTool
      if (DOCUMENT_EXTENSIONS.has(ext)) {
        return await this.getDocumentPreview(filePath, name, size, mime);
      }

      // Image preview (cap by size)
      if (IMAGE_EXTENSIONS.has(ext)) {
        if (size > MAX_IMAGE_BYTES) {
          return {
            kind: 'binary',
            path: filePath,
            name,
            size,
            mime,
            error: `Image too large to inline (${(size / 1024 / 1024).toFixed(1)} MB)`,
          };
        }
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');
        return {
          kind: 'image',
          path: filePath,
          name,
          size,
          mime,
          dataUri: `data:${mime};base64,${base64}`,
        };
      }

      // SVG: previewable as both image (raw markup) and text
      if (ext === '.svg' && SVG_AS_IMAGE_TOO) {
        if (size > MAX_TEXT_BYTES) {
          return {
            kind: 'binary',
            path: filePath,
            name,
            size,
            mime,
            error: 'SVG too large for inline preview',
          };
        }
        const text = fs.readFileSync(filePath, 'utf-8');
        const dataUri = `data:image/svg+xml;base64,${Buffer.from(text).toString('base64')}`;
        return {
          kind: 'image',
          path: filePath,
          name,
          size,
          mime,
          text,
          language: 'xml',
          lineCount: text.split('\n').length,
          dataUri,
        };
      }

      // Text / code preview
      if (TEXT_EXTENSIONS.has(ext) || size === 0 || this.looksTextual(filePath)) {
        if (size > MAX_TEXT_BYTES) {
          // Read the first MAX_TEXT_BYTES bytes only
          const fd = fs.openSync(filePath, 'r');
          const buffer = Buffer.alloc(MAX_TEXT_BYTES);
          fs.readSync(fd, buffer, 0, MAX_TEXT_BYTES, 0);
          fs.closeSync(fd);
          const text = buffer.toString('utf-8') + '\n…';
          return {
            kind: 'text',
            path: filePath,
            name,
            size,
            mime,
            text,
            lineCount: text.split('\n').length,
            language: detectLanguage(ext),
          };
        }
        const text = fs.readFileSync(filePath, 'utf-8');
        return {
          kind: 'text',
          path: filePath,
          name,
          size,
          mime,
          text,
          lineCount: text.split('\n').length,
          language: detectLanguage(ext),
        };
      }

      // Otherwise: binary, metadata only
      return {
        kind: 'binary',
        path: filePath,
        name,
        size,
        mime,
      };
    } catch (err) {
      logWarn('[PreviewService] preview failed:', err);
      return {
        kind: 'error',
        path: filePath,
        name,
        size: 0,
        mime: 'application/octet-stream',
        error: (err as Error).message ?? 'Unknown error',
      };
    }
  }

  /**
   * Quick heuristic: read first 512 bytes and check for null bytes.
   * Files without nulls in the first 512 bytes are probably text.
   */
  private looksTextual(filePath: string): boolean {
    try {
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(512);
      const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
      fs.closeSync(fd);
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async getPdfPreview(
    filePath: string,
    name: string,
    size: number,
    mime: string
  ): Promise<PreviewResult> {
    try {
      if (!this.pdfModule) {
        try {
          this.pdfModule = await loadCoreModule<CorePdfModule>('tools/pdf-tool.js');
        } catch {
          log('[PreviewService] core PDF tool unavailable, returning binary fallback');
        }
      }
      if (!this.pdfModule) {
        return {
          kind: 'binary',
          path: filePath,
          name,
          size,
          mime,
          error: 'PDF text extraction unavailable',
        };
      }

      const tool = new this.pdfModule.PDFTool();
      const result = await tool.extractText(filePath, { maxPages: 20 });
      if (!result.success) {
        return {
          kind: 'binary',
          path: filePath,
          name,
          size,
          mime,
          error: result.error ?? 'PDF extraction failed',
        };
      }

      return {
        kind: 'pdf',
        path: filePath,
        name,
        size,
        mime,
        pdfText: result.data?.text ?? result.output ?? '',
        pdfPages: result.data?.pageCount ?? 0,
      };
    } catch (err) {
      logWarn('[PreviewService] PDF extraction failed:', err);
      return {
        kind: 'binary',
        path: filePath,
        name,
        size,
        mime,
        error: (err as Error).message ?? 'PDF extraction failed',
      };
    }
  }

  private async getDocumentPreview(
    filePath: string,
    name: string,
    size: number,
    mime: string
  ): Promise<PreviewResult> {
    try {
      if (!this.documentModule) {
        try {
          this.documentModule = await loadCoreModule<CoreDocumentModule>('tools/document-tool.js');
        } catch {
          log('[PreviewService] core Document tool unavailable, returning binary fallback');
        }
      }
      if (!this.documentModule) {
        return {
          kind: 'binary',
          path: filePath,
          name,
          size,
          mime,
          error: 'Document text extraction unavailable',
        };
      }

      const tool = new this.documentModule.DocumentTool();
      const result = await tool.readDocument(filePath);
      if (!result.success) {
        return {
          kind: 'binary',
          path: filePath,
          name,
          size,
          mime,
          error: result.error ?? 'Document extraction failed',
        };
      }

      const extractedText = result.data?.text ?? result.output ?? '';
      const documentText =
        extractedText.length > MAX_DOCUMENT_TEXT_CHARS
          ? `${extractedText.slice(0, MAX_DOCUMENT_TEXT_CHARS)}\n...`
          : extractedText;

      return {
        kind: 'document',
        path: filePath,
        name,
        size,
        mime,
        documentText,
        documentType: result.data?.type,
        documentStats: result.data?.metadata,
      };
    } catch (err) {
      logWarn('[PreviewService] Document extraction failed:', err);
      return {
        kind: 'binary',
        path: filePath,
        name,
        size,
        mime,
        error: (err as Error).message ?? 'Document extraction failed',
      };
    }
  }
}
