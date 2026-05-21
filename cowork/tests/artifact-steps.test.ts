import { describe, it, expect } from 'vitest';
import type { TraceStep } from '../src/renderer/types';
import {
  getArtifactDisplayRole,
  getArtifactDisplayRolePriority,
  getArtifactSteps,
  getArtifactLabel,
  getDocxValidationEvidence,
  getDocxValidationEvidenceDisplay,
} from '../src/renderer/utils/artifact-steps';

describe('getArtifactSteps', () => {
  it('includes completed Write tool calls as file steps when no artifacts exist', () => {
    const steps: TraceStep[] = [
      {
        id: 'call_write',
        type: 'tool_call',
        status: 'completed',
        title: 'Write',
        toolName: 'Write',
        toolOutput: 'File created successfully at: /tmp/monthly_report_2026.xlsx',
        timestamp: Date.now(),
      },
      {
        id: 'call_bash',
        type: 'tool_call',
        status: 'completed',
        title: 'Bash',
        toolName: 'Bash',
        toolOutput: '-rw-r--r-- 1 user staff 1234 Feb 3 14:14 monthly_report_2026.xlsx',
        timestamp: Date.now(),
      },
    ];

    const { artifactSteps, fileSteps, displayArtifactSteps } = getArtifactSteps(steps);

    expect(artifactSteps).toHaveLength(0);
    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
    expect(displayArtifactSteps[0].toolName).toBe('Write');
  });

  it('uses toolInput path when toolOutput does not include a path', () => {
    const steps: TraceStep[] = [
      {
        id: 'call_write_input_only',
        type: 'tool_call',
        status: 'completed',
        title: 'Write',
        toolName: 'Write',
        toolInput: { path: '/tmp/from-input-only.txt', content: 'hello' },
        toolOutput: 'File created',
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);
    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
  });

  it('uses wrapped write tool output from runtime traces', () => {
    const steps: TraceStep[] = [
      {
        id: 'call_write_wrapped',
        type: 'tool_call',
        status: 'completed',
        title: 'write',
        toolName: 'write',
        toolOutput: JSON.stringify({
          content: [
            {
              type: 'text',
              text: 'Successfully wrote 2986 bytes to agent_papers_summary.html',
            },
          ],
        }),
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);
    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
    expect(displayArtifactSteps[0].toolName).toBe('write');
  });

  it('includes completed Edit tool calls as file steps when no artifacts exist', () => {
    const steps: TraceStep[] = [
      {
        id: 'call_edit',
        type: 'tool_call',
        status: 'completed',
        title: 'Edit',
        toolName: 'Edit',
        toolInput: { path: '/tmp/notes.md', old_string: 'old', new_string: 'new' },
        toolOutput: 'File edited: /tmp/notes.md',
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);
    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
    expect(displayArtifactSteps[0].toolName).toBe('Edit');
  });

  it('filters out file steps without any resolvable file path', () => {
    const steps: TraceStep[] = [
      {
        id: 'call_write_no_path',
        type: 'tool_call',
        status: 'completed',
        title: 'Write',
        toolName: 'Write',
        toolOutput: 'File created successfully',
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);
    expect(fileSteps).toHaveLength(0);
    expect(displayArtifactSteps).toHaveLength(0);
  });

  it('deduplicates repeated updates for the same file path', () => {
    const steps: TraceStep[] = [
      {
        id: 'write_1',
        type: 'tool_call',
        status: 'completed',
        title: 'Write',
        toolName: 'Write',
        toolOutput: 'File created successfully at: /tmp/repeated.txt',
        timestamp: Date.now(),
      },
      {
        id: 'write_2',
        type: 'tool_call',
        status: 'completed',
        title: 'Write',
        toolName: 'Write',
        toolInput: { path: '/tmp/repeated.txt', content: 'updated' },
        toolOutput: 'Updated',
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);
    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
  });

  it('prefers concrete file operations over explicit artifact summaries', () => {
    const steps: TraceStep[] = [
      {
        id: 'artifact_1',
        type: 'tool_result',
        status: 'completed',
        title: 'artifact',
        toolName: 'artifact',
        toolOutput: '{"path":"/tmp/report.xlsx"}',
        timestamp: Date.now(),
      },
      {
        id: 'call_write',
        type: 'tool_call',
        status: 'completed',
        title: 'Write',
        toolName: 'Write',
        toolOutput: 'File created successfully at: /tmp/other.xlsx',
        timestamp: Date.now(),
      },
    ];

    const { artifactSteps, fileSteps, displayArtifactSteps } = getArtifactSteps(steps);

    expect(artifactSteps).toHaveLength(1);
    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
    expect(displayArtifactSteps[0].toolName).toBe('Write');
  });

  it('shows completed edit steps even when artifact summaries also exist', () => {
    const steps: TraceStep[] = [
      {
        id: 'artifact_1',
        type: 'tool_result',
        status: 'completed',
        title: 'artifact',
        toolName: 'artifact',
        toolOutput: '{"path":"/tmp/report.xlsx"}',
        timestamp: Date.now(),
      },
      {
        id: 'call_edit',
        type: 'tool_call',
        status: 'completed',
        title: 'Edit',
        toolName: 'Edit',
        toolInput: { path: '/tmp/notes.md', old_string: 'old', new_string: 'new' },
        toolOutput: 'File edited: /tmp/notes.md',
        timestamp: Date.now(),
      },
    ];

    const { artifactSteps, fileSteps, displayArtifactSteps } = getArtifactSteps(steps);

    expect(artifactSteps).toHaveLength(1);
    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
    expect(displayArtifactSteps[0].toolName).toBe('Edit');
  });

  it('ignores explicit artifact summaries when a write step already covers the same path', () => {
    const steps: TraceStep[] = [
      {
        id: 'artifact_1',
        type: 'tool_result',
        status: 'completed',
        title: 'artifact',
        toolName: 'artifact',
        toolOutput: '{"path":"/tmp/report.xlsx"}',
        timestamp: Date.now(),
      },
      {
        id: 'call_write',
        type: 'tool_call',
        status: 'completed',
        title: 'Write',
        toolName: 'Write',
        toolInput: { path: '/tmp/report.xlsx', content: 'hello' },
        toolOutput: 'File written: /tmp/report.xlsx',
        timestamp: Date.now(),
      },
    ];

    const { displayArtifactSteps } = getArtifactSteps(steps);

    expect(displayArtifactSteps).toHaveLength(1);
    expect(displayArtifactSteps[0].toolName).toBe('Write');
  });

  it('includes screenshot tools when they return a concrete output path', () => {
    const steps: TraceStep[] = [
      {
        id: 'shot_1',
        type: 'tool_result',
        status: 'completed',
        title: 'screenshot',
        toolName: 'screenshot',
        toolOutput: JSON.stringify({ path: '/tmp/screenshot_1.png', size: 12345 }),
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);

    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
    expect(displayArtifactSteps[0].toolName).toBe('screenshot');
  });

  it('includes generated documents as file artifact steps', () => {
    const steps: TraceStep[] = [
      {
        id: 'docx_1',
        type: 'tool_result',
        status: 'completed',
        title: 'generate_document',
        toolName: 'generate_document',
        toolOutput: 'Created DOCX: D:\\Reports\\atelier-word\\livrable-final.docx',
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);

    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
    expect(displayArtifactSteps[0].toolName).toBe('generate_document');
  });

  it('includes generated document adapter aliases as file artifact steps', () => {
    const steps: TraceStep[] = [
      {
        id: 'docx_alias_1',
        type: 'tool_result',
        status: 'completed',
        title: 'document_generator',
        toolName: 'document_generator',
        toolInput: { type: 'docx' },
        toolOutput: [
          'Created DOCX: D:\\Reports\\atelier-word\\livrable-final.docx',
          'DOCX validation:',
          '- relationships: 34',
          '- embedded image relationships: 27',
          '- media files: 28',
        ].join('\n'),
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);

    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
    expect(getArtifactDisplayRole(displayArtifactSteps[0], 'D:\\Reports\\atelier-word\\livrable-final.docx'))
      .toBe('generated');
    expect(getDocxValidationEvidence(
      displayArtifactSteps[0],
      'D:\\Reports\\atelier-word\\livrable-final.docx'
    )).toEqual({
      relationshipCount: 34,
      embeddedImageCount: 27,
      mediaFileCount: 28,
    });
  });

  it('includes extracted DOCX images as file artifact steps', () => {
    const steps: TraceStep[] = [
      {
        id: 'doc_images_1',
        type: 'tool_result',
        status: 'completed',
        title: 'document',
        toolName: 'document',
        toolInput: {
          operation: 'extract_images',
          path: 'questions.docx',
          output_dir: 'screens',
        },
        toolOutput: [
          'Extracted 2 embedded image(s) to D:\\Reports\\atelier-word\\screens',
          '- D:\\Reports\\atelier-word\\screens\\image1.png (9 bytes)',
          '- D:\\Reports\\atelier-word\\screens\\image2.jpeg (10 bytes)',
        ].join('\n'),
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);

    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
    expect(displayArtifactSteps[0].toolName).toBe('document');
  });

  it('does not treat document read input paths as generated artifacts', () => {
    const steps: TraceStep[] = [
      {
        id: 'doc_read_1',
        type: 'tool_result',
        status: 'completed',
        title: 'document',
        toolName: 'document',
        toolInput: {
          operation: 'read',
          path: 'questions.docx',
        },
        toolOutput: 'Document: questions.docx',
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);

    expect(fileSteps).toHaveLength(0);
    expect(displayArtifactSteps).toHaveLength(0);
  });

  it('does not show artifact summaries by themselves in the artifacts panel list', () => {
    const steps: TraceStep[] = [
      {
        id: 'artifact_only',
        type: 'tool_result',
        status: 'completed',
        title: 'artifact',
        toolName: 'artifact',
        toolOutput: '{"path":"/tmp/report.xlsx"}',
        timestamp: Date.now(),
      },
    ];

    const { artifactSteps, fileSteps, displayArtifactSteps } = getArtifactSteps(steps);

    expect(artifactSteps).toHaveLength(1);
    expect(fileSteps).toHaveLength(0);
    expect(displayArtifactSteps).toHaveLength(0);
  });

  it('excludes Bash tool from file steps (relies on recent-files fallback)', () => {
    const steps: TraceStep[] = [
      {
        id: 'call_bash_create',
        type: 'tool_call',
        status: 'completed',
        title: 'Bash',
        toolName: 'Bash',
        toolOutput: 'File created successfully at: /tmp/generated.docx',
        timestamp: Date.now(),
      },
      {
        id: 'call_bash_python',
        type: 'tool_call',
        status: 'completed',
        title: 'Bash',
        toolName: 'bash',
        toolOutput: JSON.stringify({
          content: [{ type: 'text', text: 'Successfully wrote 2986 bytes to /tmp/report.html' }],
        }),
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);

    // Bash outputs are unpredictable — file display relies on recent-files scan
    expect(fileSteps).toHaveLength(0);
    expect(displayArtifactSteps).toHaveLength(0);
  });

  it('formats label from full path', () => {
    expect(getArtifactLabel('/Users/haoqing/tmp/simple.md')).toBe('simple.md');
  });

  it('uses basename when path exists even if name provided', () => {
    expect(getArtifactLabel('/Users/haoqing/tmp/simple.md', '自定义名称')).toBe('simple.md');
  });

  it('uses name when path is empty', () => {
    expect(getArtifactLabel('', '自定义名称')).toBe('自定义名称');
  });

  it('prefers basename over translated name', () => {
    expect(getArtifactLabel('/Users/haoqing/tmp/simple.pptx', '简单PPT演示文稿')).toBe('simple.pptx');
  });

  it('orders generated deliverables before extracted and recent evidence', () => {
    expect([
      getArtifactDisplayRolePriority('generated'),
      getArtifactDisplayRolePriority('extracted'),
      getArtifactDisplayRolePriority('file'),
      getArtifactDisplayRolePriority('recent'),
    ]).toEqual([0, 1, 2, 3]);
  });

  it('extracts DOCX validation evidence from generated document output', () => {
    const step: TraceStep = {
      id: 'docx_validated',
      type: 'tool_result',
      status: 'completed',
      title: 'generate_document',
      toolName: 'generate_document',
      toolOutput: [
        'Created DOCX: D:\\Reports\\atelier-word\\livrable-final.docx',
        'DOCX validation:',
        '- relationships: 34',
        '- embedded image relationships: 27',
        '- media files: 28',
      ].join('\n'),
      timestamp: Date.now(),
    };

    expect(getDocxValidationEvidence(step, 'D:\\Reports\\atelier-word\\livrable-final.docx'))
      .toEqual({
        relationshipCount: 34,
        embeddedImageCount: 27,
        mediaFileCount: 28,
      });
  });

  it('extracts DOCX validation evidence from JSON tool output text', () => {
    const step: TraceStep = {
      id: 'docx_validated_json_output',
      type: 'tool_result',
      status: 'completed',
      title: 'generate_document',
      toolName: 'generate_document',
      toolOutput: JSON.stringify({
        success: true,
        output: [
          'Created DOCX: D:\\Reports\\atelier-word\\livrable-final.docx',
          'DOCX validation:',
          '- relationships: 34',
          '- embedded image relationships: 27',
          '- media files: 28',
        ].join('\n'),
      }),
      timestamp: Date.now(),
    };

    expect(getDocxValidationEvidence(step, 'D:\\Reports\\atelier-word\\livrable-final.docx'))
      .toEqual({
        relationshipCount: 34,
        embeddedImageCount: 27,
        mediaFileCount: 28,
      });
  });

  it('does not attach DOCX validation evidence to generated image artifacts', () => {
    const step: TraceStep = {
      id: 'docx_validated',
      type: 'tool_result',
      status: 'completed',
      title: 'generate_document',
      toolName: 'generate_document',
      toolOutput: JSON.stringify({
        data: {
          outputPath: 'D:\\Reports\\atelier-word\\livrable-final.docx',
          embeddedImages: [{ path: 'D:\\Reports\\atelier-word\\screens\\image1.png' }],
          docxValidation: {
            relationshipCount: 34,
            embeddedRelationshipCount: 27,
            mediaFileCount: 28,
          },
        },
      }),
      timestamp: Date.now(),
    };

    expect(getDocxValidationEvidence(step, 'D:\\Reports\\atelier-word\\screens\\image1.png'))
      .toBeNull();
  });

  it('builds a compact visible label for DOCX validation with image and media counts', () => {
    expect(getDocxValidationEvidenceDisplay({
      relationshipCount: 34,
      embeddedImageCount: 27,
      mediaFileCount: 28,
    })).toEqual({
      labelKey: 'context.docxValidationEvidenceWithMedia',
      labelValues: { images: 27, media: 28 },
      titleKey: 'context.docxValidationEvidenceTitle',
      titleValues: { relationships: 34, media: 28 },
    });
  });

  it('falls back to the image-only DOCX validation label when media count is unavailable', () => {
    expect(getDocxValidationEvidenceDisplay({
      relationshipCount: 12,
      embeddedImageCount: 3,
    })).toEqual({
      labelKey: 'context.docxValidationEvidence',
      labelValues: { count: 3 },
      titleKey: 'context.docxValidationEvidenceTitle',
      titleValues: { relationships: 12, media: 0 },
    });
  });

  it('falls back to a plain DOCX validation label when no image count is available', () => {
    expect(getDocxValidationEvidenceDisplay({
      relationshipCount: 7,
      mediaFileCount: 0,
    })).toEqual({
      labelKey: 'context.docxValidationEvidenceNoImages',
      labelValues: {},
      titleKey: 'context.docxValidationEvidenceTitle',
      titleValues: { relationships: 7, media: 0 },
    });
    expect(getDocxValidationEvidenceDisplay(null)).toBeNull();
  });
});
