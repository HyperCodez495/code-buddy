import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import { PreviewService, detectPreviewMime } from '../src/main/preview/preview-service';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('PreviewService MIME detection', () => {
  it('recognizes document attachments instead of generic binary MIME', () => {
    expect(detectPreviewMime('.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(detectPreviewMime('.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(detectPreviewMime('.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
    expect(detectPreviewMime('.pdf')).toBe('application/pdf');
    expect(detectPreviewMime('.csv')).toBe('text/csv');
  });

  it('keeps text and unknown fallbacks stable', () => {
    expect(detectPreviewMime('.ts')).toBe('text/plain');
    expect(detectPreviewMime('.unknown')).toBe('application/octet-stream');
  });
});

describe('PreviewService document previews', () => {
  it('extracts Office document text through the core DocumentTool', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codebuddy-preview-'));
    const docPath = join(tempDir, 'questions.docx');
    writeFileSync(docPath, 'placeholder');

    try {
      class DocumentTool {
        async readDocument(filePath: string) {
          expect(filePath).toBe(docPath);
          return {
            success: true,
            data: {
              text: 'Question 1: describe the impact diagram.',
              type: 'docx',
              metadata: { wordCount: 6, embeddedImageCount: 2 },
            },
          };
        }
      }

      mockedLoadCoreModule.mockResolvedValue({ DocumentTool });

      const result = await new PreviewService().getPreview(docPath);

      expect(mockedLoadCoreModule).toHaveBeenCalledWith('tools/document-tool.js');
      expect(result).toMatchObject({
        kind: 'document',
        name: 'questions.docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        documentText: 'Question 1: describe the impact diagram.',
        documentType: 'docx',
        documentStats: { wordCount: 6, embeddedImageCount: 2 },
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('falls back to binary metadata when document extraction is unavailable', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codebuddy-preview-'));
    const docPath = join(tempDir, 'questions.docx');
    writeFileSync(docPath, 'placeholder');

    try {
      mockedLoadCoreModule.mockResolvedValue(null);

      const result = await new PreviewService().getPreview(docPath);

      expect(result).toMatchObject({
        kind: 'binary',
        name: 'questions.docx',
        error: 'Document text extraction unavailable',
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
