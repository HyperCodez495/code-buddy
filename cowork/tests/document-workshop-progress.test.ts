import { describe, expect, it } from 'vitest';
import {
  buildDocumentWorkshopEvidenceChips,
  buildDocumentWorkshopMemoryContent,
  getDocumentWorkshopProgress,
  getDocumentWorkshopReadiness,
} from '../src/renderer/utils/document-workshop-progress';
import type { Message, TraceStep } from '../src/renderer/types';

function userMessage(content: Message['content']): Message {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content,
    timestamp: 1,
  };
}

function assistantMessage(text: string): Message {
  return {
    id: 'msg-assistant-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 2,
  };
}

function toolStep(
  id: string,
  toolName: string,
  operation: string | undefined,
  status: TraceStep['status'] = 'completed',
  overrides: Partial<TraceStep> = {}
): TraceStep {
  return {
    id,
    type: 'tool_result',
    status,
    title: toolName,
    toolName,
    toolInput: operation ? { operation } : undefined,
    timestamp: 1,
    ...overrides,
  };
}

describe('document workshop progress', () => {
  it('stays hidden before a workshop-like document flow starts', () => {
    const progress = getDocumentWorkshopProgress([], [], 0);

    expect(progress.visible).toBe(false);
    expect(progress.completedCount).toBe(0);
    expect(progress.todos).toEqual([]);
    expect(progress.traceCompletedCount).toBe(0);
    expect(progress.traceTotalCount).toBe(4);
    expect(progress.traceEvidence).toEqual({
      questionCount: 0,
      imageCount: 0,
      ocrEvidenceCount: 0,
      bindingCount: 0,
      artifactCount: 0,
    });
  });

  it('marks the source step when a Word document is attached', () => {
    const progress = getDocumentWorkshopProgress([
      userMessage([
        {
          type: 'file_attachment',
          filename: 'Questions - Impacts.docx',
          relativePath: 'D:\\Reports\\Questions - Impacts.docx',
          size: 1024,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      ]),
    ], [], 0);

    expect(progress.visible).toBe(true);
    expect(progress.steps.find((step) => step.id === 'source')?.status).toBe('done');
    expect(progress.steps.find((step) => step.id === 'read')?.status).toBe('pending');
    expect(progress.todos.map((todo) => [todo.id, todo.status])).toEqual([
      ['read', 'pending'],
      ['context', 'pending'],
      ['questions', 'pending'],
    ]);
  });

  it('tracks question extraction, OCR, deliverable generation and visible artifacts', () => {
    const progress = getDocumentWorkshopProgress(
      [
        userMessage([
          {
            type: 'text',
            text: 'Atelier Word sur le document joint',
          },
        ]),
        assistantMessage('Questions extraites : Question 1 - Quels sont les impacts ? Reponses redigees question par question.'),
      ],
      [
        toolStep('read-1', 'document', 'read'),
        toolStep('context-1', 'document', undefined, 'completed', {
          toolOutput: 'Analyse fonctionnelle avant les questions : captures et tableaux conserves.',
        }),
        toolStep('images-1', 'document', 'extract_images'),
        toolStep('ocr-1', 'ocr_extract', undefined, 'completed', {
          content: 'OCR terminé pour les captures intégrées.',
        }),
        toolStep('docx-1', 'generate_document', undefined),
      ],
      3
    );

    expect(progress.visible).toBe(true);
    expect(progress.completedCount).toBe(9);
    expect(progress.steps.map((step) => [step.id, step.status])).toEqual([
      ['source', 'done'],
      ['read', 'done'],
      ['context', 'done'],
      ['questions', 'done'],
      ['images', 'done'],
      ['ocr', 'done'],
      ['answers', 'done'],
      ['deliverable', 'done'],
      ['artifacts', 'done'],
    ]);
    expect(progress.todos).toEqual([]);
    expect(progress.traceCompletedCount).toBe(4);
    expect(progress.traceLinks.map((link) => [link.id, link.status])).toEqual([
      ['questionContext', 'done'],
      ['ocrEvidence', 'done'],
      ['answerEvidence', 'done'],
      ['deliverableEvidence', 'done'],
    ]);
    expect(progress.traceEvidence).toMatchObject({
      questionCount: 1,
      ocrEvidenceCount: 1,
      artifactCount: 3,
    });
  });

  it('shows active work when a workshop tool is currently running', () => {
    const progress = getDocumentWorkshopProgress(
      [],
      [toolStep('docx-1', 'generate_document', undefined, 'running')],
      0
    );

    expect(progress.visible).toBe(true);
    expect(progress.steps.find((step) => step.id === 'deliverable')?.status).toBe('active');
    expect(progress.todos[0]).toEqual({ id: 'deliverable', status: 'active' });
  });

  it('marks question and OCR steps active from running trace evidence', () => {
    const progress = getDocumentWorkshopProgress(
      [],
      [
        toolStep('questions-1', 'document', undefined, 'running', {
          content: 'Extraction des questions en cours',
        }),
        toolStep('ocr-1', 'ocr', undefined, 'pending', {
          title: 'OCR screenshots',
        }),
      ],
      0
    );

    expect(progress.visible).toBe(true);
    expect(progress.steps.find((step) => step.id === 'questions')?.status).toBe('active');
    expect(progress.steps.find((step) => step.id === 'ocr')?.status).toBe('active');
    expect(progress.traceLinks.find((link) => link.id === 'questionContext')?.status).toBe('active');
    expect(progress.traceLinks.find((link) => link.id === 'ocrEvidence')?.status).toBe('active');
    expect(progress.traceLinks.find((link) => link.id === 'answerEvidence')?.status).toBe('pending');
  });

  it('tracks answer drafting separately before the DOCX deliverable exists', () => {
    const progress = getDocumentWorkshopProgress(
      [assistantMessage('Reponses preparees pour les questions extraites, avec justification detaillee.')],
      [],
      0
    );

    expect(progress.visible).toBe(true);
    expect(progress.steps.find((step) => step.id === 'answers')?.status).toBe('done');
    expect(progress.steps.find((step) => step.id === 'deliverable')?.status).toBe('pending');
  });

  it('marks answers active from running trace evidence', () => {
    const progress = getDocumentWorkshopProgress(
      [],
      [
        toolStep('answers-1', 'reasoning', undefined, 'running', {
          content: 'Reponses preparees en brouillon',
        }),
      ],
      0
    );

    expect(progress.visible).toBe(true);
    expect(progress.steps.find((step) => step.id === 'answers')?.status).toBe('active');
  });

  it('tracks functional-analysis context separately from question extraction', () => {
    const progress = getDocumentWorkshopProgress(
      [assistantMessage('Contexte fonctionnel capture : les captures et tableaux du document sont conserves.')],
      [],
      0
    );

    expect(progress.visible).toBe(true);
    expect(progress.steps.find((step) => step.id === 'context')?.status).toBe('done');
    expect(progress.steps.find((step) => step.id === 'questions')?.status).toBe('pending');
  });

  it('counts extracted screenshots as preserved functional context', () => {
    const progress = getDocumentWorkshopProgress(
      [],
      [
        toolStep('images-1', 'document', 'extract_images', 'completed', {
          toolOutput: 'Extracted 2 embedded image(s) to D:\\Reports\\screens',
        }),
      ],
      2
    );

    expect(progress.visible).toBe(true);
    expect(progress.steps.find((step) => step.id === 'context')?.status).toBe('done');
    expect(progress.steps.find((step) => step.id === 'images')?.status).toBe('done');
  });

  it('marks functional context active while screenshots are being extracted', () => {
    const progress = getDocumentWorkshopProgress(
      [],
      [toolStep('images-1', 'document', 'extract_images', 'running')],
      0
    );

    expect(progress.visible).toBe(true);
    expect(progress.steps.find((step) => step.id === 'context')?.status).toBe('active');
    expect(progress.steps.find((step) => step.id === 'images')?.status).toBe('active');
  });

  it('counts PDF extraction as document reading for workshop progress', () => {
    const progress = getDocumentWorkshopProgress(
      [
        userMessage([
          {
            type: 'file_attachment',
            filename: 'Analyse fonctionnelle.pdf',
            relativePath: 'D:\\Reports\\Analyse fonctionnelle.pdf',
            size: 2048,
            mimeType: 'application/pdf',
          },
        ]),
      ],
      [toolStep('pdf-read-1', 'pdf', 'extract')],
      0
    );

    expect(progress.visible).toBe(true);
    expect(progress.steps.find((step) => step.id === 'source')?.status).toBe('done');
    expect(progress.steps.find((step) => step.id === 'read')?.status).toBe('done');
  });

  it('counts PDF to_base64 as visual context prepared for screenshot-heavy PDFs', () => {
    const progress = getDocumentWorkshopProgress(
      [],
      [
        toolStep('pdf-vision-1', 'pdf', 'to_base64', 'completed', {
          toolOutput: 'PDF converted to base64 for vision review.',
        }),
      ],
      0
    );

    expect(progress.visible).toBe(true);
    expect(progress.steps.find((step) => step.id === 'context')?.status).toBe('done');
    expect(progress.steps.find((step) => step.id === 'images')?.status).toBe('done');
  });

  it('marks PDF visual context active while to_base64 is running', () => {
    const progress = getDocumentWorkshopProgress(
      [],
      [toolStep('pdf-vision-1', 'pdf', 'to_base64', 'running')],
      0
    );

    expect(progress.visible).toBe(true);
    expect(progress.steps.find((step) => step.id === 'context')?.status).toBe('active');
    expect(progress.steps.find((step) => step.id === 'images')?.status).toBe('active');
  });

  it('recognizes DOCX generation from adapter aliases and output evidence', () => {
    const progress = getDocumentWorkshopProgress(
      [],
      [
        toolStep('docx-1', 'document_generator', undefined, 'completed', {
          toolInput: { type: 'docx' },
          toolOutput: 'Created DOCX: D:\\Reports\\livrable.docx\nDOCX validation: ok',
        }),
      ],
      1
    );

    expect(progress.visible).toBe(true);
    expect(progress.steps.find((step) => step.id === 'answers')?.status).toBe('done');
    expect(progress.steps.find((step) => step.id === 'deliverable')?.status).toBe('done');
    expect(progress.steps.find((step) => step.id === 'artifacts')?.status).toBe('done');
  });

  it('marks the deliverable done when the assistant announces a generated DOCX', () => {
    const progress = getDocumentWorkshopProgress(
      [
        assistantMessage(
          'Livrable genere : D:\\Reports\\Questions - Impacts-livrable.docx. Le document DOCX est pret.'
        ),
      ],
      [],
      1
    );

    expect(progress.visible).toBe(true);
    expect(progress.steps.find((step) => step.id === 'answers')?.status).toBe('done');
    expect(progress.steps.find((step) => step.id === 'deliverable')?.status).toBe('done');
    expect(progress.steps.find((step) => step.id === 'artifacts')?.status).toBe('done');
  });

  it('builds a compact memory entry for a validated Word workshop deliverable', () => {
    const progress = getDocumentWorkshopProgress(
      [
        userMessage([
          {
            type: 'text',
            text: 'Atelier Word sur le document joint',
          },
        ]),
        assistantMessage('Questions extraites et reponses preparees. DOCX genere et valide.'),
      ],
      [
        toolStep('read-1', 'document', 'read'),
        toolStep('docx-1', 'generate_document', undefined, 'completed', {
          toolOutput: 'DOCX validation: ok',
        }),
      ],
      1
    );

    const memory = buildDocumentWorkshopMemoryContent(progress, [
      {
        label: 'Questions - Impacts-livrable.docx',
        path: 'D:\\Reports\\Questions - Impacts-livrable.docx',
        role: 'generated',
        evidence: { embeddedImageCount: 27, mediaFileCount: 27 },
      },
    ]);

    expect(memory).toContain('Word workshop memory');
    expect(memory).toContain('Progress:');
    expect(memory).toContain('Generated deliverables:');
    expect(memory).toContain('Traceability completed:');
    expect(memory).toContain('answers linked to evidence');
    expect(memory).toContain('Traceability in progress:');
    expect(memory).toContain('Questions - Impacts-livrable.docx');
    expect(memory).toContain('27 image(s), 27 media file(s)');
  });

  it('treats the workshop traceability completion marker as completed trace links', () => {
    const progress = getDocumentWorkshopProgress(
      [assistantMessage('Traceabilite atelier complete : les questions, OCR et reponses sont relies.')],
      [],
      0
    );

    expect(progress.visible).toBe(true);
    expect(progress.traceCompletedCount).toBe(4);
    expect(progress.traceLinks.every((link) => link.status === 'done')).toBe(true);
  });

  it('extracts traceability evidence counts from question, image and OCR traces', () => {
    const progress = getDocumentWorkshopProgress(
      [
        assistantMessage(
          'Questions extraites : Question 1, Question 2, Q3. OCR termine pour 3 captures avec markdownRef.'
        ),
      ],
      [
        toolStep('images-1', 'document', 'extract_images', 'completed', {
          toolOutput: 'Extracted 27 embedded image(s) to D:\\Reports\\screens',
        }),
      ],
      28
    );

    expect(progress.traceEvidence).toEqual({
      questionCount: 3,
      imageCount: 27,
      ocrEvidenceCount: 3,
      bindingCount: 0,
      artifactCount: 28,
    });
  });

  it('uses aggregate question counts from real workshop summaries', () => {
    const progress = getDocumentWorkshopProgress(
      [
        assistantMessage(
          'Questions extraites : 30 questions.\n' +
            'Traceability rows: 3.\n' +
            'Embedded images in generated DOCX: 27.'
        ),
      ],
      [
        toolStep('docx-smoke', 'generate_document', undefined, 'completed', {
          toolOutput: JSON.stringify({
            questionCount: 30,
            traceabilityRows: 3,
            embeddedImagesInGeneratedDocx: 27,
          }),
        }),
      ],
      27
    );

    expect(progress.traceEvidence.questionCount).toBe(30);
    expect(progress.traceEvidence.imageCount).toBe(27);
    expect(progress.steps.find((step) => step.id === 'deliverable')?.status).toBe('done');
    expect(progress.steps.find((step) => step.id === 'artifacts')?.status).toBe('done');
  });

  it('builds visible evidence chips with observed state for the ContextPanel', () => {
    const progress = getDocumentWorkshopProgress(
      [
        assistantMessage(
          'Questions extraites : 30 questions. OCR termine pour 27 captures.'
        ),
      ],
      [
        toolStep('images-1', 'document', 'extract_images', 'completed', {
          toolOutput: 'Extracted 27 embedded image(s) to D:\\Reports\\screens',
        }),
      ],
      28
    );

    expect(buildDocumentWorkshopEvidenceChips(progress)).toEqual([
      { id: 'questions', count: 30, observed: true },
      { id: 'images', count: 27, observed: true },
      { id: 'ocr', count: 27, observed: true },
      { id: 'bindings', count: 0, observed: false },
      { id: 'artifacts', count: 28, observed: true },
    ]);
  });

  it('reports Word deliverable readiness from completed traceability and artifacts', () => {
    const progress = getDocumentWorkshopProgress(
      [
        assistantMessage(
          'Questions extraites : 30 questions. Traceabilite atelier complete. DOCX genere et valide.'
        ),
      ],
      [
        toolStep('read', 'document', 'read', 'completed', {
          toolOutput: 'Document read',
        }),
        toolStep('images-1', 'document', 'extract_images', 'completed', {
          toolOutput: 'Extracted 27 embedded image(s) to D:\\Reports\\screens',
        }),
        toolStep('ocr-1', 'ocr_extract', undefined, 'completed', {
          toolOutput: 'OCR termine pour 27 captures.',
        }),
        toolStep('docx-1', 'generate_document', undefined, 'completed', {
          toolOutput: 'Created DOCX: D:\\Reports\\Questions - Impacts-livrable.docx',
        }),
      ],
      28
    );

    expect(getDocumentWorkshopReadiness(progress, [{
      label: 'Questions - Impacts-livrable.docx',
      path: 'D:\\Reports\\Questions - Impacts-livrable.docx',
      role: 'generated',
      evidence: { relationshipCount: 34, embeddedImageCount: 27, mediaFileCount: 28 },
    }])).toEqual({
      status: 'ready',
      missingStepIds: [],
      missingTraceLinkIds: [],
      docxValidationObserved: true,
    });
  });

  it('blocks Word deliverable readiness when the generated DOCX has no validation evidence', () => {
    const progress = getDocumentWorkshopProgress(
      [
        assistantMessage(
          'Questions extraites : 30 questions. Traceabilite atelier complete. DOCX genere.'
        ),
      ],
      [
        toolStep('read', 'document', 'read', 'completed', {
          toolOutput: 'Document read',
        }),
        toolStep('docx-1', 'generate_document', undefined, 'completed', {
          toolOutput: 'Created DOCX: D:\\Reports\\Questions - Impacts-livrable.docx',
        }),
      ],
      1
    );

    expect(getDocumentWorkshopReadiness(progress, [{
      label: 'Questions - Impacts-livrable.docx',
      path: 'D:\\Reports\\Questions - Impacts-livrable.docx',
      role: 'generated',
      evidence: null,
    }])).toMatchObject({
      status: 'needsEvidence',
      docxValidationObserved: false,
    });
  });

  it('keeps Word deliverable readiness in progress until traceability evidence is complete', () => {
    const progress = getDocumentWorkshopProgress(
      [assistantMessage('Questions extraites : 30 questions.')],
      [],
      0
    );

    expect(getDocumentWorkshopReadiness(progress)).toMatchObject({
      status: 'inProgress',
      missingStepIds: expect.arrayContaining(['read', 'deliverable', 'artifacts']),
      missingTraceLinkIds: expect.arrayContaining(['deliverableEvidence']),
    });
  });

  it('counts question-to-evidence bindings when questions mention OCR or markdown references', () => {
    const progress = getDocumentWorkshopProgress(
      [
        assistantMessage(
          'Question 1 : impact confirmé par markdownRef image-1.\n' +
            'Q2 : OCR summary from capture login.\n' +
            'Question 3 : answer only, no visual evidence.'
        ),
      ],
      [],
      0
    );

    expect(progress.traceEvidence.bindingCount).toBe(2);
  });

  it('does not mark the deliverable done for future-tense generation plans', () => {
    const progress = getDocumentWorkshopProgress(
      [assistantMessage('Je vais generer le livrable DOCX apres validation des reponses.')],
      [],
      0
    );

    expect(progress.steps.find((step) => step.id === 'answers')?.status).toBe('pending');
    expect(progress.steps.find((step) => step.id === 'deliverable')?.status).toBe('pending');
  });
});
