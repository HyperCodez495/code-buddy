import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import {
  buildAttachmentOnlyPrompt,
  buildAttachedFilesPromptContext,
  extractAttachmentTextExcerpt,
  resolveAttachmentPath,
  shouldIncludeDocumentWorkshopGuidance,
} from '../src/main/session/file-attachment-context';
import type { FileAttachmentContent } from '../src/renderer/types';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

function attachment(input: Partial<FileAttachmentContent>): FileAttachmentContent {
  return {
    type: 'file_attachment',
    filename: 'questions.docx',
    relativePath: '.tmp/questions.docx',
    size: 1024,
    ...input,
  };
}

describe('file attachment prompt context', () => {
  it('resolves relative attachment paths from the session cwd', () => {
    const cwd = join(tmpdir(), 'project');
    const absolute = join(tmpdir(), 'questions.docx');
    expect(resolveAttachmentPath(cwd, join('.tmp', 'questions.docx'))).toBe(
      join(cwd, '.tmp', 'questions.docx')
    );
    expect(resolveAttachmentPath(cwd, absolute)).toBe(absolute);
  });

  it('adds extracted DOCX text excerpts to the attached-file prompt context', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codebuddy-attachment-'));
    const docPath = join(tempDir, 'questions.docx');
    writeFileSync(docPath, 'placeholder');

    try {
      class DocumentTool {
        async readDocument(filePath: string) {
          expect(filePath).toBe(docPath);
          return {
            success: true,
            data: { text: 'Functional analysis before question one.', type: 'docx' },
          };
        }
      }
      mockedLoadCoreModule.mockResolvedValue({ DocumentTool });

      const context = await buildAttachedFilesPromptContext([
        attachment({
          relativePath: docPath,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ], undefined, 'Répondre aux questions du document de travail');

      expect(context).toContain('[Attached files - use Read tool to access them]');
      expect(context).toContain('[Document workshop guidance]');
      expect(context).toContain(
        'Include in the final deliverable the functional-analysis context that appears before each question'
      );
      expect(context).toContain(
        'Maintain a compact question-context registry with columns: Question id, source context, screenshot/OCR reference, answer status'
      );
      expect(context).toContain(
        'Treat table rows and [Embedded image: ...] markers in excerpts as functional-analysis context'
      );
      expect(context).toContain(
        'for DOCX, run document read, then document extract_images with an output_dir'
      );
      expect(context).toContain(
        'For PDF, run pdf extract with max_pages first'
      );
      expect(context).toContain('[Document workshop path hints]');
      expect(context).toContain(
        'questions.docx: document extract_images output_dir'
      );
      expect(context).toContain('questions-images');
      expect(context).toContain('questions-livrable.docx');
      expect(context).toContain(
        'ocr batch on extracted image paths before final answers'
      );
      expect(context).toContain(
        'Emit short progress markers when the work is done: "Contexte fonctionnel capture"'
      );
      expect(context).toContain('"Questions extraites" after the question inventory');
      expect(context).toContain('"OCR termine" after screenshot OCR');
      expect(context).toContain('"Reponses preparees" after drafting the question-by-question answers');
      expect(context).toContain('"Traceabilite atelier complete"');
      expect(context).toContain(
        'bind that OCR summary to the nearby question and keep the extracted image markdownRef'
      );
      expect(context).toContain(
        'Include OCR-backed screenshot references in the deliverable by reusing extract_images markdownRef values'
      );
      expect(context).toContain(
        'Expected answer structure for each question: Synthese courte, Explication detaillee'
      );
      expect(context).toContain(
        'Rendering rules: Mermaid edges need explicit labels'
      );
      expect(context).toContain(
        'do not add visible numeric quality scores such as "Score qualite 0/100"'
      );
      expect(context).toContain(
        'validate Word compatibility signals: package relationships, embedded media count'
      );
      expect(context).toContain(
        'use generate_document with type docx plus a matching .docx output path'
      );
      expect(context).toContain('[Attached file text excerpts - verify against source before final answers]');
      expect(context).toContain('### questions.docx');
      expect(context).toContain('Functional analysis before question one.');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('adds extracted PDF text excerpts and workshop path hints to the prompt context', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codebuddy-attachment-'));
    const pdfPath = join(tempDir, 'analyse-fonctionnelle.pdf');
    writeFileSync(pdfPath, '%PDF-1.4 placeholder');

    try {
      class PDFTool {
        async extractText(filePath: string, options?: { maxPages?: number }) {
          expect(filePath).toBe(pdfPath);
          expect(options).toMatchObject({ maxPages: 20 });
          return {
            success: true,
            data: {
              text:
                'Analyse fonctionnelle PDF avant questions.\n' +
                'Question 1: quels impacts pour le traitement?',
            },
          };
        }
      }
      mockedLoadCoreModule.mockImplementation(async (modulePath: string) => {
        if (modulePath === 'tools/pdf-tool.js') {
          return { PDFTool };
        }
        return null;
      });

      const context = await buildAttachedFilesPromptContext(
        [
          attachment({
            filename: 'analyse-fonctionnelle.pdf',
            relativePath: pdfPath,
            mimeType: 'application/pdf',
          }),
        ],
        undefined,
        'Please answer every question from this document workshop'
      );

      expect(context).toContain('[Document workshop guidance]');
      expect(context).toContain('[Document workshop path hints]');
      expect(context).toContain('analyse-fonctionnelle.pdf: pdf extract path');
      expect(context).toContain('max_pages 20');
      expect(context).toContain('pdf to_base64 for vision/OCR review');
      expect(context).not.toContain('analyse-fonctionnelle.pdf: document extract_images');
      expect(context).toContain('analyse-fonctionnelle-livrable.docx');
      expect(context).toContain('[Attached file text excerpts - verify against source before final answers]');
      expect(context).toContain('### analyse-fonctionnelle.pdf');
      expect(context).toContain('Analyse fonctionnelle PDF avant questions.');
      expect(context).toContain('Question 1: quels impacts pour le traitement?');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('builds workshop context from a real DOCX with table and image markers', async () => {
    const { default: AdmZip } = await import('adm-zip');
    const { DocumentTool } = await import('../../src/tools/document-tool.js');
    const tempDir = mkdtempSync(join(tmpdir(), 'codebuddy-attachment-'));
    const docPath = join(tempDir, 'questions-with-context.docx');
    const zip = new AdmZip();
    zip.addFile(
      'word/document.xml',
      Buffer.from(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
          'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
          '<w:body>' +
          '<w:p><w:r><w:t>Analyse fonctionnelle avant questions</w:t></w:r></w:p>' +
          '<w:tbl>' +
          '<w:tr><w:tc><w:p><w:r><w:t>Question</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Contexte</w:t></w:r></w:p></w:tc></w:tr>' +
          '<w:tr><w:tc><w:p><w:r><w:t>Question 1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Capture ecran impact demande</w:t></w:r></w:p></w:tc></w:tr>' +
          '</w:tbl>' +
          '<w:p><w:r><w:drawing><a:blip r:embed="rId9"/></w:drawing></w:r></w:p>' +
          '<w:p><w:r><w:t>Question 2: detailler le traitement?</w:t></w:r></w:p>' +
          '</w:body>' +
          '</w:document>'
      )
    );
    zip.addFile(
      'word/_rels/document.xml.rels',
      Buffer.from(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/screen-impact.png"/>' +
          '</Relationships>'
      )
    );
    writeFileSync(docPath, zip.toBuffer());

    try {
      mockedLoadCoreModule.mockResolvedValue({ DocumentTool });

      const context = await buildAttachedFilesPromptContext(
        [
          attachment({
            filename: 'questions-with-context.docx',
            relativePath: docPath,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
        ],
        undefined,
        'Repondre aux questions du document de travail'
      );

      expect(context).toContain('[Document workshop guidance]');
      expect(context).toContain('[Document workshop path hints]');
      expect(context).toContain('questions-with-context-images');
      expect(context).toContain('questions-with-context-livrable.docx');
      expect(context).toContain('[Attached file text excerpts - verify against source before final answers]');
      expect(context).toContain('Analyse fonctionnelle avant questions');
      expect(context).toContain('[Table]');
      expect(context).toContain('Question\tContexte');
      expect(context).toContain('Question 1\tCapture ecran impact demande');
      expect(context).toContain('[Embedded image: media/screen-impact.png]');
      expect(context).toContain('Question 2: detailler le traitement?');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('extracts plain text attachments without loading core document tools', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codebuddy-attachment-'));
    const notePath = join(tempDir, 'notes.md');
    writeFileSync(notePath, '# Analysis\nQuestion: What changes?');

    try {
      const excerpt = await extractAttachmentTextExcerpt(
        attachment({
          filename: 'notes.md',
          relativePath: notePath,
          mimeType: 'text/markdown',
        })
      );

      expect(excerpt).toBe('# Analysis\nQuestion: What changes?');
      expect(mockedLoadCoreModule).not.toHaveBeenCalled();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps the compact attached-file section when no text can be extracted', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    const context = await buildAttachedFilesPromptContext([
      attachment({
        relativePath: 'missing.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ]);

    expect(context).toBe(
      '[Attached files - use Read tool to access them]:\n' +
        '- questions.docx (1.0 KB, type: application/vnd.openxmlformats-officedocument.wordprocessingml.document) at path: missing.docx'
    );
  });

  it('detects document workshop intent only for question-answer document flows', () => {
    const docx = attachment({
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const image = attachment({
      filename: 'diagram.png',
      relativePath: '.tmp/diagram.png',
      mimeType: 'image/png',
    });

    expect(shouldIncludeDocumentWorkshopGuidance('Réponds aux questions', [docx])).toBe(true);
    expect(shouldIncludeDocumentWorkshopGuidance('Please answer every question', [docx])).toBe(true);
    expect(shouldIncludeDocumentWorkshopGuidance('Résume ce document', [docx])).toBe(false);
    expect(shouldIncludeDocumentWorkshopGuidance('Réponds aux questions', [image])).toBe(false);
  });

  it('builds a useful implicit prompt when only a document is attached', async () => {
    const docx = attachment({
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const prompt = buildAttachmentOnlyPrompt([docx]);

    expect(prompt).toContain('Analyze the attached document(s): questions.docx');
    expect(prompt).toContain('identify every question');
    expect(prompt).toContain('generate a DOCX deliverable');
    expect(shouldIncludeDocumentWorkshopGuidance(prompt ?? '', [docx])).toBe(true);
  });

  it('builds a compact implicit prompt for non-document attachments', () => {
    expect(
      buildAttachmentOnlyPrompt([
        attachment({
          filename: 'diagram.png',
          relativePath: '.tmp/diagram.png',
          mimeType: 'image/png',
        }),
      ])
    ).toBe('Analyze the attached file(s): diagram.png.');
  });
});
