import { describe, expect, it, vi } from 'vitest';
import {
  buildAttachmentFromDroppedFile,
  buildAttachmentFromPath,
  buildComposerContentBlocks,
  buildDocumentWorkshopPrompt,
  getDocumentWorkshopSubmissionPrompt,
  getDroppedFilePath,
  getFileNameFromPath,
  hasDocumentWorkshopAttachment,
  inferAttachmentMimeType,
  isDroppedFolderCandidate,
} from '../src/renderer/utils/file-attachment-helpers';

function fileLike(
  overrides: Partial<File> & { path?: string; name: string; size?: number; type?: string }
): File {
  return {
    name: overrides.name,
    size: overrides.size ?? 0,
    type: overrides.type ?? '',
    path: overrides.path,
  } as File & { path?: string };
}

describe('file attachment helpers', () => {
  it('builds selected-path attachments with useful document MIME types', () => {
    expect(getFileNameFromPath('D:\\Reports\\questions.docx')).toBe('questions.docx');
    expect(buildAttachmentFromPath('D:\\Reports\\questions.docx')).toEqual({
      name: 'questions.docx',
      path: 'D:\\Reports\\questions.docx',
      size: 0,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(inferAttachmentMimeType('analysis.pdf')).toBe('application/pdf');
    expect(inferAttachmentMimeType('table.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(inferAttachmentMimeType('notes.unknown')).toBe('application/octet-stream');
  });

  it('keeps a provided browser MIME type when it is specific', () => {
    expect(inferAttachmentMimeType('notes.md', 'text/x-markdown')).toBe('text/x-markdown');
    expect(inferAttachmentMimeType('notes.md', 'application/octet-stream')).toBe('text/markdown');
  });

  it('detects folder drops and preserves inline data only for pathless files', async () => {
    const folder = fileLike({ name: 'Project', path: 'D:\\Project', type: '' });
    const pickedDoc = fileLike({
      name: 'questions.docx',
      path: 'D:\\Reports\\questions.docx',
      size: 120,
      type: '',
    });
    const pastedDoc = fileLike({ name: 'questions.docx', size: 120, type: '' });
    const blobToBase64 = vi.fn(async () => 'base64-docx');

    expect(isDroppedFolderCandidate(folder)).toBe(true);
    expect(isDroppedFolderCandidate(pickedDoc)).toBe(false);
    expect(getDroppedFilePath(pickedDoc)).toBe('D:\\Reports\\questions.docx');

    await expect(buildAttachmentFromDroppedFile(pickedDoc, blobToBase64)).resolves.toMatchObject({
      path: 'D:\\Reports\\questions.docx',
      inlineDataBase64: undefined,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(blobToBase64).not.toHaveBeenCalled();

    await expect(buildAttachmentFromDroppedFile(pastedDoc, blobToBase64)).resolves.toMatchObject({
      path: '',
      inlineDataBase64: 'base64-docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(blobToBase64).toHaveBeenCalledTimes(1);
  });

  it('detects Word-workshop attachments and builds the standard prompt', () => {
    expect(hasDocumentWorkshopAttachment({
      name: 'questions.docx',
      type: 'application/octet-stream',
    })).toBe(true);
    expect(hasDocumentWorkshopAttachment({
      name: 'audit.pdf',
      type: 'application/pdf',
    })).toBe(true);
    expect(hasDocumentWorkshopAttachment({
      name: 'table.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })).toBe(false);

    const prompt = buildDocumentWorkshopPrompt([
      { name: 'questions.docx' },
      { name: 'annexe.pdf' },
    ]);

    expect(prompt).toContain('questions.docx, annexe.pdf');
    expect(prompt).toContain('Extrais toutes les questions');
    expect(prompt).toContain('contexte fonctionnel situe avant chaque question');
    expect(prompt).toContain('registre Question | Contexte source | Capture/OCR | Reponse');
    expect(prompt).toContain('captures ecran');
    expect(prompt).toContain('insere les captures pertinentes dans le livrable final');
    expect(prompt).toContain('Contexte fonctionnel capture');
    expect(prompt).toContain('Questions extraites');
    expect(prompt).toContain('OCR termine');
    expect(prompt).toContain('Reponses preparees');
    expect(prompt).toContain('Traceabilite atelier complete');
    expect(prompt).toContain('relations, medias integres et chemins de sortie compatibles Word');
    expect(prompt).toContain('n ajoute pas de score qualite numerique visible');
    expect(prompt).toContain('Genere ensuite un document DOCX technique complet');
  });

  it('uses the workshop prompt as the submission text for blank document-only sends', () => {
    const docx = {
      name: 'Questions - Impacts.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };

    expect(getDocumentWorkshopSubmissionPrompt('', [docx])).toContain(
      'Analyse les documents attaches (Questions - Impacts.docx)'
    );
    expect(getDocumentWorkshopSubmissionPrompt('  Reponds uniquement a la question 7  ', [docx])).toBe(
      'Reponds uniquement a la question 7'
    );
    expect(getDocumentWorkshopSubmissionPrompt('', [{ name: 'notes.txt', type: 'text/plain' }])).toBe('');
  });

  it('builds composer content blocks in the same order the backend expects', () => {
    const blocks = buildComposerContentBlocks(
      '',
      [
        {
          name: 'Questions - Impacts.docx',
          path: 'D:\\Reports\\Questions - Impacts.docx',
          size: 4096,
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      ],
      [
        {
          url: 'blob:preview',
          base64: 'image-base64',
          mediaType: 'image/png',
        },
      ]
    );

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'image-base64',
      },
    });
    expect(blocks[1]).toMatchObject({
      type: 'file_attachment',
      filename: 'Questions - Impacts.docx',
      relativePath: 'D:\\Reports\\Questions - Impacts.docx',
      size: 4096,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(blocks[2]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Analyse les documents attaches (Questions - Impacts.docx)'),
    });
  });
});
