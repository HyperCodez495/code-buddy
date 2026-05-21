import type { TraceStep } from '../types';
import { extractFilePathFromToolInput, extractFilePathFromToolOutput } from './tool-output-path';

const FILE_TOOL_NAMES = new Set([
  'write_file',
  'edit_file',
  'Write',
  'Edit',
  'write',
  'edit',
  'NotebookEdit',
  'notebook_edit',
  'generate_document',
  'document_generator',
  'document_generate',
  'generate_docx',
]);

const DOCUMENT_GENERATOR_TOOL_NAMES = new Set([
  'generate_document',
  'document_generator',
  'document_generate',
  'generate_docx',
]);

const DOCUMENT_IMAGE_EXTRACTION_TOOL_NAMES = new Set([
  'document_extract_images',
  'docx_extract_images',
]);

function normalizeToolName(toolName: string | undefined): string {
  return toolName?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') ?? '';
}

function isReliablePathToolName(toolName: string | undefined): boolean {
  if (!toolName) {
    return false;
  }
  if (FILE_TOOL_NAMES.has(toolName)) {
    return true;
  }

  const normalized = normalizeToolName(toolName);
  if (FILE_TOOL_NAMES.has(normalized) || DOCUMENT_IMAGE_EXTRACTION_TOOL_NAMES.has(normalized)) {
    return true;
  }

  return /(?:^|__|_)(?:screenshot|take_screenshot|capture_screenshot)(?:$|__|_)/.test(normalized);
}

function isReliablePathStep(step: TraceStep): boolean {
  if (step.toolName === 'document') {
    return step.toolInput?.operation === 'extract_images';
  }
  return isReliablePathToolName(step.toolName);
}

type ArtifactStepResult = {
  artifactSteps: TraceStep[];
  fileSteps: TraceStep[];
  displayArtifactSteps: TraceStep[];
};

export function getArtifactLabel(pathValue: string, name?: string): string {
  const trimmedName = name?.trim();
  const trimmedPath = pathValue.trim();
  if (trimmedPath) {
    const normalized = trimmedPath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || trimmedPath;
  }

  return trimmedName ?? '';
}

export type ArtifactIconKey =
  | 'slides'
  | 'table'
  | 'doc'
  | 'code'
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'
  | 'file';

export type ArtifactIconComponent =
  | 'presentation'
  | 'table'
  | 'document'
  | 'code'
  | 'image'
  | 'text'
  | 'audio'
  | 'video'
  | 'archive'
  | 'file';

export type ArtifactDisplayRole =
  | 'generated'
  | 'extracted'
  | 'recent'
  | 'file';

export type DocxValidationEvidence = {
  relationshipCount?: number;
  embeddedImageCount?: number;
  mediaFileCount?: number;
};

export type DocxValidationEvidenceDisplay = {
  labelKey:
    | 'context.docxValidationEvidenceWithMedia'
    | 'context.docxValidationEvidence'
    | 'context.docxValidationEvidenceNoImages';
  labelValues: Record<string, number>;
  titleKey: 'context.docxValidationEvidenceTitle';
  titleValues: {
    relationships: number;
    media: number;
  };
};

const extensionIconMap: Record<string, ArtifactIconKey> = {
  pptx: 'slides',
  ppt: 'slides',
  key: 'slides',
  keynote: 'slides',
  xlsx: 'table',
  xls: 'table',
  csv: 'table',
  tsv: 'table',
  docx: 'doc',
  doc: 'doc',
  pdf: 'doc',
  md: 'code',
  markdown: 'code',
  js: 'code',
  jsx: 'code',
  ts: 'code',
  tsx: 'code',
  py: 'code',
  java: 'code',
  go: 'code',
  rs: 'code',
  c: 'code',
  cpp: 'code',
  h: 'code',
  hpp: 'code',
  css: 'code',
  scss: 'code',
  html: 'code',
  json: 'code',
  lock: 'code',
  yaml: 'code',
  yml: 'code',
  txt: 'text',
  log: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  ogg: 'audio',
  mp4: 'video',
  mov: 'video',
  mkv: 'video',
  webm: 'video',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
};

export function getArtifactIconKey(filename: string): ArtifactIconKey {
  const normalized = filename.trim().toLowerCase();
  const lastDot = normalized.lastIndexOf('.');
  if (lastDot === -1 || lastDot === normalized.length - 1) {
    return 'file';
  }

  const ext = normalized.slice(lastDot + 1);
  return extensionIconMap[ext] ?? 'file';
}

export function getArtifactIconComponent(filename: string): ArtifactIconComponent {
  const key = getArtifactIconKey(filename);
  switch (key) {
    case 'slides':
      return 'presentation';
    case 'table':
      return 'table';
    case 'doc':
      return 'document';
    case 'code':
      return 'code';
    case 'image':
      return 'image';
    case 'audio':
      return 'audio';
    case 'video':
      return 'video';
    case 'archive':
      return 'archive';
    case 'text':
      return 'text';
    default:
      return 'file';
  }
}

export function getArtifactDisplayRole(
  step?: Pick<TraceStep, 'toolName' | 'toolInput'> | null,
  pathValue?: string
): ArtifactDisplayRole {
  const toolName = normalizeToolName(step?.toolName);
  if (DOCUMENT_GENERATOR_TOOL_NAMES.has(toolName) || step?.toolInput?.type === 'docx') {
    return pathValue?.trim().toLowerCase().endsWith('.docx') === false ? 'file' : 'generated';
  }
  if (
    (toolName === 'document' && step?.toolInput?.operation === 'extract_images') ||
    DOCUMENT_IMAGE_EXTRACTION_TOOL_NAMES.has(toolName)
  ) {
    return 'extracted';
  }
  return step ? 'file' : 'recent';
}

export function getArtifactDisplayRoleLabel(role: ArtifactDisplayRole): string {
  switch (role) {
    case 'generated':
      return 'Generated';
    case 'extracted':
      return 'Extracted';
    case 'recent':
      return 'Recent';
    default:
      return 'File';
  }
}

export function getArtifactDisplayRolePriority(role: ArtifactDisplayRole): number {
  switch (role) {
    case 'generated':
      return 0;
    case 'extracted':
      return 1;
    case 'file':
      return 2;
    case 'recent':
      return 3;
    default:
      return 4;
  }
}

export function getDocxValidationEvidence(
  step?: Pick<TraceStep, 'toolName' | 'toolOutput'> | null,
  pathValue?: string
): DocxValidationEvidence | null {
  if (!DOCUMENT_GENERATOR_TOOL_NAMES.has(normalizeToolName(step?.toolName)) || !step?.toolOutput) {
    return null;
  }
  if (pathValue && !pathValue.trim().toLowerCase().endsWith('.docx')) {
    return null;
  }

  const fromJson = parseDocxValidationEvidenceFromJson(step.toolOutput);
  if (fromJson) {
    return fromJson;
  }

  return parseDocxValidationEvidenceFromText(step.toolOutput);
}

export function getDocxValidationEvidenceDisplay(
  evidence?: DocxValidationEvidence | null
): DocxValidationEvidenceDisplay | null {
  if (!evidence) {
    return null;
  }

  const images = evidence.embeddedImageCount ?? 0;
  const media = evidence.mediaFileCount ?? 0;
  const titleValues = {
    relationships: evidence.relationshipCount ?? 0,
    media,
  };

  if (images > 0 && media > 0) {
    return {
      labelKey: 'context.docxValidationEvidenceWithMedia',
      labelValues: { images, media },
      titleKey: 'context.docxValidationEvidenceTitle',
      titleValues,
    };
  }

  if (images > 0) {
    return {
      labelKey: 'context.docxValidationEvidence',
      labelValues: { count: images },
      titleKey: 'context.docxValidationEvidenceTitle',
      titleValues,
    };
  }

  return {
    labelKey: 'context.docxValidationEvidenceNoImages',
    labelValues: {},
    titleKey: 'context.docxValidationEvidenceTitle',
    titleValues,
  };
}

function parseDocxValidationEvidenceFromJson(toolOutput: string): DocxValidationEvidence | null {
  try {
    const parsed = JSON.parse(toolOutput) as {
      output?: unknown;
      data?: {
        docxValidation?: Record<string, unknown>;
      };
      docxValidation?: Record<string, unknown>;
    };
    const validation = parsed.data?.docxValidation ?? parsed.docxValidation;
    if (!validation) {
      return typeof parsed.output === 'string'
        ? parseDocxValidationEvidenceFromText(parsed.output)
        : null;
    }

    const evidence: DocxValidationEvidence = {
      relationshipCount: readNumber(validation.relationshipCount),
      embeddedImageCount:
        readNumber(validation.embeddedRelationshipCount)
        ?? readNumber(validation.embeddedImageCount),
      mediaFileCount: readNumber(validation.mediaFileCount),
    };

    return hasDocxValidationEvidence(evidence) ? evidence : null;
  } catch {
    return null;
  }
}

function parseDocxValidationEvidenceFromText(toolOutput: string): DocxValidationEvidence | null {
  if (!/DOCX validation:/i.test(toolOutput)) {
    return null;
  }

  const evidence: DocxValidationEvidence = {
    relationshipCount: readFirstNumber(toolOutput, /^\s*-\s*relationships:\s*(\d+)/im),
    embeddedImageCount: readFirstNumber(
      toolOutput,
      /^\s*-\s*embedded image relationships:\s*(\d+)/im
    ),
    mediaFileCount: readFirstNumber(toolOutput, /^\s*-\s*media files:\s*(\d+)/im),
  };

  return hasDocxValidationEvidence(evidence) ? evidence : null;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readFirstNumber(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern);
  if (!match?.[1]) {
    return undefined;
  }

  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : undefined;
}

function hasDocxValidationEvidence(evidence: DocxValidationEvidence): boolean {
  return Object.values(evidence).some((value) => typeof value === 'number');
}

export function getArtifactSteps(steps: TraceStep[]): ArtifactStepResult {
  const artifactSteps = steps.filter(
    (step) => step.type === 'tool_result' && step.toolName === 'artifact'
  );

  const rawFileSteps = steps.filter((step) => {
    if (step.status !== 'completed') {
      return false;
    }
    if (!isReliablePathStep(step)) {
      return false;
    }
    const pathFromOutput = extractFilePathFromToolOutput(step.toolOutput);
    const pathFromInput = step.toolName === 'document'
      ? null
      : extractFilePathFromToolInput(step.toolInput);
    if (!pathFromOutput && !pathFromInput) {
      return false;
    }
    return step.type === 'tool_result' || step.type === 'tool_call';
  });

  // Keep only one entry per file path to avoid noisy duplicates.
  const seenPaths = new Set<string>();
  const fileSteps: TraceStep[] = [];
  for (let i = rawFileSteps.length - 1; i >= 0; i -= 1) {
    const step = rawFileSteps[i];
    const pathValue = extractFilePathFromToolOutput(step.toolOutput)
      || extractFilePathFromToolInput(step.toolInput)
      || '';
    const key = pathValue.trim();
    if (!key || seenPaths.has(key)) {
      continue;
    }
    seenPaths.add(key);
    fileSteps.unshift(step);
  }

  return {
    artifactSteps,
    fileSteps,
    displayArtifactSteps: fileSteps,
  };
}
