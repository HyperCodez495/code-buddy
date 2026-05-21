import { describe, expect, it } from 'vitest';
import type { Message, TextContent, TraceStep } from '../src/renderer/types';
import {
  buildComposerContentBlocks,
  type AttachedFile,
} from '../src/renderer/utils/file-attachment-helpers';
import {
  getDocumentWorkshopReadiness,
  getDocumentWorkshopProgress,
} from '../src/renderer/utils/document-workshop-progress';
import {
  getArtifactLabel,
  getArtifactDisplayRole,
  getArtifactDisplayRolePriority,
  getDocxValidationEvidence,
  type ArtifactDisplayRole,
  type DocxValidationEvidence,
} from '../src/renderer/utils/artifact-steps';
import { extractFilePathsFromToolOutput } from '../src/renderer/utils/tool-output-path';

function toolStep(
  id: string,
  toolName: string,
  operation: string | undefined,
  toolOutput: string
): TraceStep {
  return {
    id,
    type: 'tool_result',
    status: 'completed',
    title: toolName,
    toolName,
    toolInput: operation ? { operation } : undefined,
    toolOutput,
    timestamp: 1,
  };
}

describe('document workshop flow', () => {
  it('models a blank DOCX attachment from composer prompt to progress and artifact ordering', () => {
    const attachedFiles: AttachedFile[] = [
      {
        name: 'Questions - Impacts.docx',
        path: 'D:\\Alise\\Questions - Impacts.docx',
        size: 4096,
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    ];

    const contentBlocks = buildComposerContentBlocks('', attachedFiles, []);
    const promptBlock = contentBlocks.find((block): block is TextContent => block.type === 'text');

    expect(contentBlocks[0]).toMatchObject({
      type: 'file_attachment',
      filename: 'Questions - Impacts.docx',
      relativePath: 'D:\\Alise\\Questions - Impacts.docx',
    });
    expect(promptBlock?.text).toContain('Analyse les documents attaches');
    expect(promptBlock?.text).toContain('Questions extraites');
    expect(promptBlock?.text).toContain('OCR termine');
    expect(promptBlock?.text).toContain('Reponses preparees');
    expect(promptBlock?.text).toContain('Traceabilite atelier complete');
    expect(promptBlock?.text).toContain('compatibles Word');
    expect(promptBlock?.text).toContain('Score qualite 0/100');

    const userMessage: Message = {
      id: 'user-1',
      sessionId: 'session-1',
      role: 'user',
      content: contentBlocks,
      timestamp: 1,
    };
    const assistantProgressMessage: Message = {
      id: 'assistant-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Questions extraites\nOCR termine',
        },
      ],
      timestamp: 2,
    };

    const traceSteps: TraceStep[] = [
      toolStep('read', 'document', 'read', 'Document read: Questions - Impacts.docx'),
      toolStep(
        'images',
        'document',
        'extract_images',
        [
          'Extracted 1 embedded image(s) to D:\\Alise\\Questions - Impacts-images',
          '- D:\\Alise\\Questions - Impacts-images\\image1.png',
        ].join('\n')
      ),
      toolStep('ocr', 'ocr_extract', undefined, 'OCR termine pour image1.png'),
      toolStep(
        'docx',
        'generate_document',
        undefined,
        'Created DOCX: D:\\Alise\\Questions - Impacts-livrable.docx'
      ),
    ];

    const progress = getDocumentWorkshopProgress(
      [userMessage, assistantProgressMessage],
      traceSteps,
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

    const artifactRoles: Array<{ label: string; role: ArtifactDisplayRole }> = [
      { label: 'image1.png', role: getArtifactDisplayRole(traceSteps[1]) },
      { label: 'Questions - Impacts-livrable.docx', role: getArtifactDisplayRole(traceSteps[3]) },
      { label: 'recent.tmp', role: getArtifactDisplayRole(null) },
    ];

    const sortedLabels = [...artifactRoles]
      .sort(
        (a, b) => getArtifactDisplayRolePriority(a.role) - getArtifactDisplayRolePriority(b.role)
      )
      .map((artifact) => artifact.label);

    expect(sortedLabels).toEqual([
      'Questions - Impacts-livrable.docx',
      'image1.png',
      'recent.tmp',
    ]);
  });

  it('maps real generate_document DOCX evidence without promoting embedded PNGs', () => {
    const outputPath = 'D:\\Alise\\Questions - Impacts-livrable.docx';
    const imagePath = 'D:\\Alise\\Questions - Impacts-images\\image1.png';
    const generateStep = toolStep(
      'docx',
      'generate_document',
      undefined,
      JSON.stringify({
        data: {
          outputPath,
          embeddedImages: [{
            path: imagePath,
            caption: 'Source screenshot - image1.png',
            width: 800,
            height: 450,
          }],
          docxValidation: {
            relationshipCount: 34,
            embeddedRelationshipCount: 27,
            mediaFileCount: 28,
          },
        },
      })
    );

    const artifactPaths = extractFilePathsFromToolOutput(generateStep.toolOutput);
    const artifacts = artifactPaths.map((pathValue) => ({
      label: getArtifactLabel(pathValue),
      role: getArtifactDisplayRole(generateStep, pathValue),
      evidence: getDocxValidationEvidence(generateStep, pathValue),
    }));

    expect(artifactPaths).toEqual([outputPath, imagePath]);
    expect(artifacts).toEqual([
      {
        label: 'Questions - Impacts-livrable.docx',
        role: 'generated',
        evidence: {
          relationshipCount: 34,
          embeddedImageCount: 27,
          mediaFileCount: 28,
        } satisfies DocxValidationEvidence,
      },
      {
        label: 'image1.png',
        role: 'file',
        evidence: null,
      },
    ]);
  });

  it('smokes the renderer path from blank document attachment to validated Word readiness', () => {
    const attachedFiles: AttachedFile[] = [
      {
        name: 'Questions - Impacts.docx',
        path: 'D:\\Alise\\Questions - Impacts.docx',
        size: 4096,
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    ];
    const contentBlocks = buildComposerContentBlocks('', attachedFiles, []);
    const userMessage: Message = {
      id: 'user-1',
      sessionId: 'session-1',
      role: 'user',
      content: contentBlocks,
      timestamp: 1,
    };
    const assistantMessage: Message = {
      id: 'assistant-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: [{
        type: 'text',
        text:
          'Contexte fonctionnel capture. Questions extraites : 30 questions. ' +
          'OCR termine pour 27 captures. Reponses preparees. ' +
          'Traceabilite atelier complete. DOCX genere et valide.',
      }],
      timestamp: 2,
    };
    const outputPath = 'D:\\Alise\\Questions - Impacts-livrable.docx';
    const imagePath = 'D:\\Alise\\Questions - Impacts-images\\image1.png';
    const traceSteps: TraceStep[] = [
      toolStep('read', 'document', 'read', 'Document read: Questions - Impacts.docx'),
      toolStep(
        'images',
        'document',
        'extract_images',
        'Extracted 27 embedded image(s) to D:\\Alise\\Questions - Impacts-images'
      ),
      toolStep('ocr', 'ocr_extract', undefined, 'OCR termine pour 27 captures.'),
      toolStep(
        'docx',
        'generate_document',
        undefined,
        JSON.stringify({
          data: {
            outputPath,
            embeddedImages: [{
              path: imagePath,
              caption: 'Source screenshot - image1.png',
            }],
            docxValidation: {
              relationshipCount: 34,
              embeddedRelationshipCount: 27,
              mediaFileCount: 28,
            },
          },
        })
      ),
    ];
    const artifactPaths = extractFilePathsFromToolOutput(traceSteps[3].toolOutput);
    const artifacts = artifactPaths.map((pathValue) => ({
      label: getArtifactLabel(pathValue),
      path: pathValue,
      role: getArtifactDisplayRole(traceSteps[3], pathValue),
      evidence: getDocxValidationEvidence(traceSteps[3], pathValue),
    }));
    const progress = getDocumentWorkshopProgress(
      [userMessage, assistantMessage],
      traceSteps,
      artifacts.length
    );

    expect(artifactPaths).toEqual([outputPath, imagePath]);
    expect(progress.traceCompletedCount).toBe(4);
    expect(progress.traceEvidence).toMatchObject({
      questionCount: 30,
      imageCount: 27,
      ocrEvidenceCount: 27,
      artifactCount: 2,
    });
    expect(getDocumentWorkshopReadiness(progress, artifacts)).toEqual({
      status: 'ready',
      missingStepIds: [],
      missingTraceLinkIds: [],
      docxValidationObserved: true,
    });
  });
});
