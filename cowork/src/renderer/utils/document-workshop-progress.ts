import type { Message, TraceStep } from '../types';

export type DocumentWorkshopStepId =
  | 'source'
  | 'read'
  | 'context'
  | 'questions'
  | 'images'
  | 'ocr'
  | 'answers'
  | 'deliverable'
  | 'artifacts';

export type DocumentWorkshopStepStatus = 'done' | 'active' | 'pending';

export interface DocumentWorkshopStep {
  id: DocumentWorkshopStepId;
  status: DocumentWorkshopStepStatus;
}

export interface DocumentWorkshopTodo {
  id: DocumentWorkshopStepId;
  status: Exclude<DocumentWorkshopStepStatus, 'done'>;
}

export type DocumentWorkshopTraceLinkId =
  | 'questionContext'
  | 'ocrEvidence'
  | 'answerEvidence'
  | 'deliverableEvidence';

export interface DocumentWorkshopTraceLink {
  id: DocumentWorkshopTraceLinkId;
  status: DocumentWorkshopStepStatus;
}

export interface DocumentWorkshopTraceEvidence {
  questionCount: number;
  imageCount: number;
  ocrEvidenceCount: number;
  bindingCount: number;
  artifactCount: number;
}

export interface DocumentWorkshopProgress {
  visible: boolean;
  completedCount: number;
  totalCount: number;
  steps: DocumentWorkshopStep[];
  todos: DocumentWorkshopTodo[];
  traceLinks: DocumentWorkshopTraceLink[];
  traceCompletedCount: number;
  traceTotalCount: number;
  traceEvidence: DocumentWorkshopTraceEvidence;
}

export interface DocumentWorkshopMemoryArtifact {
  label: string;
  path: string;
  role?: string;
  evidence?: {
    imageCount?: number;
    embeddedImageCount?: number;
    mediaCount?: number;
    mediaFileCount?: number;
    relationshipCount?: number;
  } | null;
}

export type DocumentWorkshopEvidenceChipId =
  | 'questions'
  | 'images'
  | 'ocr'
  | 'bindings'
  | 'artifacts';

export interface DocumentWorkshopEvidenceChip {
  id: DocumentWorkshopEvidenceChipId;
  count: number;
  observed: boolean;
}

export type DocumentWorkshopReadinessStatus = 'ready' | 'inProgress' | 'needsEvidence';

export interface DocumentWorkshopReadiness {
  status: DocumentWorkshopReadinessStatus;
  missingStepIds: DocumentWorkshopStepId[];
  missingTraceLinkIds: DocumentWorkshopTraceLinkId[];
  docxValidationObserved: boolean;
}

const DOCUMENT_EXTENSIONS = new Set(['docx', 'pdf']);

const STEP_MEMORY_LABELS: Record<DocumentWorkshopStepId, string> = {
  source: 'source attached',
  read: 'document read',
  context: 'functional context captured',
  questions: 'questions identified',
  images: 'screenshots/pages prepared',
  ocr: 'screenshots/pages OCR analyzed',
  answers: 'answers prepared',
  deliverable: 'DOCX deliverable generated',
  artifacts: 'artifacts visible',
};

const TRACE_MEMORY_LABELS: Record<DocumentWorkshopTraceLinkId, string> = {
  questionContext: 'questions linked to functional context',
  ocrEvidence: 'screenshots linked to OCR evidence',
  answerEvidence: 'answers linked to evidence',
  deliverableEvidence: 'deliverable linked to generated artifacts',
};

const QUESTION_EXTRACTION_PATTERNS = [
  /\bextraction\s+(?:des?\s+)?questions?\b/,
  /\bquestion\s+extraction\b/,
  /\bquestions?\s+(extraites?|identifiees?|reperees?|detectees?|listees?)\b/,
  /\b(?:extracted|identified|detected|listed)\s+questions?\b/,
  /\bquestion\s+(?:n[°o]\s*)?\d+\b/,
  /\bq\d+\b/,
];

const FUNCTIONAL_CONTEXT_PATTERNS = [
  /\bcontexte\s+fonctionnel\b/,
  /\banalyse\s+fonctionnelle\b/,
  /\bfunctional[-\s]+analysis\s+context\b/,
  /\bfunctional\s+context\b/,
  /\b(?:preserved|captured|mapped)\s+(?:the\s+)?context\b/,
  /\b(?:captures?|screenshots?|tableaux|tables?)\b.*\b(?:contexte|context)\b/,
];

const OCR_ANALYSIS_PATTERNS = [
  /\bocr\b/,
  /\bmarkdownref\b/,
  /\bcaptures?\b.*\b(?:analysees?|ocr|texte)\b/,
  /\bscreenshots?\b.*\b(?:analyzed|analysed|ocr|text)\b/,
  /\btexte\s+(?:extrait|reconnu)\b.*\bcaptures?\b/,
];

const ANSWER_GENERATION_PATTERNS = [
  /\breponses?\s+(?:generees?|redigees?|produites?|preparees?|finalisees?)\b/,
  /\b(?:generees?|redigees?|produites?|preparees?|finalisees?)\s+(?:des?\s+)?reponses?\b/,
  /\banswers?\s+(?:generated|drafted|prepared|written|produced|finalized|finalised)\b/,
  /\b(?:generated|drafted|prepared|written|produced|finalized|finalised)\s+answers?\b/,
  /\breponse\s+question\s+par\s+question\b/,
  /\bquestion-by-question\s+answers?\b/,
];

const DELIVERABLE_GENERATION_PATTERNS = [
  /\blivrable\b.*\b(?:genere|cree|pret|disponible|produit)\b/,
  /\bdocument\b.*\b(?:genere|cree|pret|disponible|produit)\b.*\bdocx\b/,
  /\bdocx\b.*\b(?:genere|cree|valide|created|generated|validated|ready)\b/,
  /\b(?:created|generated|validated)\s+docx\b/,
];

const TRACEABILITY_COMPLETE_PATTERNS = [
  /\btraceabilite\s+atelier\s+complete\b/,
  /\bworkshop\s+traceability\s+complete\b/,
  /\btraceability\s+complete\b/,
];

function extensionOf(value: string | undefined): string {
  const match = value?.toLowerCase().match(/\.([^.\\/]+)$/);
  return match?.[1] ?? '';
}

function isDocumentAttachmentBlock(block: unknown): boolean {
  const candidate = block as {
    type?: string;
    filename?: string;
    relativePath?: string;
    mimeType?: string;
  };
  if (candidate?.type !== 'file_attachment') {
    return false;
  }

  const ext = extensionOf(candidate.filename || candidate.relativePath);
  return (
    DOCUMENT_EXTENSIONS.has(ext) ||
    candidate.mimeType === 'application/pdf' ||
    Boolean(candidate.mimeType?.includes('wordprocessingml'))
  );
}

function hasWorkshopIntent(messages: Message[]): boolean {
  return messages.some((message) => {
    if (message.role !== 'user') {
      return false;
    }

    return message.content.some((block) => {
      if (isDocumentAttachmentBlock(block)) {
        return true;
      }
      if (block.type !== 'text') {
        return false;
      }
      const normalized = block.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return normalized.includes('atelier word') || normalized.includes('document workshop');
    });
  });
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function textFromMessage(message: Message): string {
  return message.content
    .map((block) => {
      if (block.type === 'text') {
        return block.text;
      }
      if (block.type === 'thinking') {
        return block.thinking;
      }
      if (block.type === 'tool_result') {
        return block.content;
      }
      if (block.type === 'tool_use') {
        return block.name;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function traceStepText(step: TraceStep): string {
  return [step.title, step.content, step.toolName, step.toolOutput].filter(Boolean).join('\n');
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function hasPattern(value: string, patterns: RegExp[]): boolean {
  const normalized = normalizeSearchText(value);
  return patterns.some((pattern) => pattern.test(normalized));
}

function textCorpus(messages: Message[], traceSteps: TraceStep[]): string {
  return [
    ...messages.map(textFromMessage),
    ...traceSteps.map(traceStepText),
  ].join('\n');
}

function countQuestionReferences(value: string): number {
  const normalized = normalizeSearchText(value);
  const ids = new Set<string>();
  for (const match of normalized.matchAll(/\bquestion\s+(?:n[°o]\s*)?(\d+)\b/g)) {
    ids.add(match[1]);
  }
  for (const match of normalized.matchAll(/\bq\s*[-#:]?\s*(\d+)\b/g)) {
    ids.add(match[1]);
  }
  const aggregateCount = maxCountForPatterns(normalized, [
    /\b(\d+)\s+questions?\s+(?:extraites?|identifiees?|reperees?|detectees?|listees?|extracted|identified|detected|listed)\b/g,
    /\bquestions?\s+(?:extraites?|identifiees?|reperees?|detectees?|listees?|extracted|identified|detected|listed)\s*[:=-]?\s*(\d+)\b/g,
    /\bquestions?\s*[:=-]\s*(\d+)\b/g,
    /\bquestioncount["']?\s*[:=]\s*(\d+)\b/g,
    /\bquestion_count["']?\s*[:=]\s*(\d+)\b/g,
  ]);
  return Math.max(ids.size, aggregateCount);
}

function maxCountForPatterns(value: string, patterns: RegExp[]): number {
  let max = 0;
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const count = Number.parseInt(match[1] ?? '', 10);
      if (Number.isFinite(count) && count > max) {
        max = count;
      }
    }
  }
  return max;
}

function countOcrEvidence(value: string): number {
  const normalized = normalizeSearchText(value);
  const markdownRefs = normalized.match(/\bmarkdownref\b/g)?.length ?? 0;
  const explicitOcrCount = maxCountForPatterns(normalized, [
    /(\d+)\s+(?:captures?|screenshots?|images?)\s+(?:ocr|analysees?|analyzed|analysed)/g,
    /ocr\s+(?:sur|for|pour)\s+(\d+)\s+(?:captures?|screenshots?|images?)/g,
    /ocr\b.*?\b(?:sur|for|pour)\s+(\d+)\s+(?:captures?|screenshots?|images?)/g,
  ]);
  if (markdownRefs > 0 || explicitOcrCount > 0) {
    return Math.max(markdownRefs, explicitOcrCount);
  }
  return hasPattern(normalized, OCR_ANALYSIS_PATTERNS) ? 1 : 0;
}

function countImageEvidence(value: string): number {
  const normalized = normalizeSearchText(value);
  return maxCountForPatterns(normalized, [
    /(?:extracted|prepared|found|embedded|visible)\s+(\d+)\s+(?:embedded\s+)?images?/g,
    /(\d+)\s+(?:embedded\s+)?images?/g,
    /(\d+)\s+(?:captures?|screenshots?)/g,
    /\b(?:embedded|generated)\s+images?\b[^0-9]{0,40}(\d+)\b/g,
    /\bembeddedimagesingenerateddocx["']?\s*[:=]\s*(\d+)\b/g,
    /\bembeddedimagecount["']?\s*[:=]\s*(\d+)\b/g,
  ]);
}

function countQuestionEvidenceBindings(value: string): number {
  const normalized = normalizeSearchText(value);
  const ids = new Set<string>();
  const evidencePattern = /\b(?:ocr|markdownref|capture|captures|screenshot|screenshots|image|images|preuve|preuves|evidence)\b/;
  const negativeEvidencePattern = /\b(?:no|without|sans|aucune?)\b.{0,40}\b(?:preuve|preuves|evidence)\b/;

  const segments = normalized.split(/(?:\r?\n)+|(?<=[.!?;])\s+/);
  for (const segment of segments) {
    if (!evidencePattern.test(segment) || negativeEvidencePattern.test(segment)) {
      continue;
    }
    for (const match of segment.matchAll(/\bquestion\s+(?:n[°o]\s*)?(\d+)\b/g)) {
      ids.add(match[1]);
    }
    for (const match of segment.matchAll(/\bq\s*[-#:]?\s*(\d+)\b/g)) {
      ids.add(match[1]);
    }
  }

  return ids.size;
}

function assistantMessageMatches(messages: Message[], patterns: RegExp[]): boolean {
  return messages.some((message) => message.role === 'assistant' && hasPattern(textFromMessage(message), patterns));
}

function isDocumentReadStep(step: TraceStep): boolean {
  const toolName = normalizeIdentifier(step.toolName);
  const operation = normalizeIdentifier(step.toolInput?.operation);

  if (toolName === 'document') {
    return operation === 'read' || operation === 'read_document' || operation === 'extract_text';
  }

  if (toolName === 'pdf') {
    return operation === 'extract' || operation === 'extract_text' || operation === 'read';
  }

  return (
    toolName === 'document_read' ||
    toolName === 'read_document' ||
    toolName === 'pdf_extract' ||
    toolName === 'pdf_extract_text'
  );
}

function isDocumentImageExtractionStep(step: TraceStep): boolean {
  const toolName = normalizeIdentifier(step.toolName);
  const operation = normalizeIdentifier(step.toolInput?.operation);
  return (
    (toolName === 'document' && operation === 'extract_images') ||
    (toolName === 'pdf' && operation === 'to_base64') ||
    toolName === 'document_extract_images' ||
    toolName === 'docx_extract_images' ||
    toolName === 'pdf_to_base64'
  );
}

function isQuestionExtractionStep(step: TraceStep): boolean {
  return hasPattern(traceStepText(step), QUESTION_EXTRACTION_PATTERNS);
}

function isFunctionalContextStep(step: TraceStep): boolean {
  return hasPattern(traceStepText(step), FUNCTIONAL_CONTEXT_PATTERNS);
}

function isOcrAnalysisStep(step: TraceStep): boolean {
  const toolName = normalizeIdentifier(step.toolName);
  return toolName === 'ocr' || toolName === 'ocr_extract' || hasPattern(traceStepText(step), OCR_ANALYSIS_PATTERNS);
}

function isAnswerGenerationStep(step: TraceStep): boolean {
  return hasPattern(traceStepText(step), ANSWER_GENERATION_PATTERNS);
}

function isDocumentGenerationStep(step: TraceStep): boolean {
  const toolName = normalizeIdentifier(step.toolName);
  const outputText = normalizeSearchText(traceStepText(step));
  const type = normalizeIdentifier(step.toolInput?.type);
  return (
    toolName === 'generate_document' ||
    toolName === 'document_generator' ||
    toolName === 'document_generate' ||
    toolName === 'generate_docx' ||
    type === 'docx' ||
    outputText.includes('created docx') ||
    outputText.includes('docx validation')
  );
}

function isTraceabilityCompleteStep(step: TraceStep): boolean {
  return hasPattern(traceStepText(step), TRACEABILITY_COMPLETE_PATTERNS);
}

function hasStep(steps: TraceStep[], predicate: (step: TraceStep) => boolean): boolean {
  return steps.some((step) => predicate(step));
}

function hasCompletedStep(steps: TraceStep[], predicate: (step: TraceStep) => boolean): boolean {
  return steps.some((step) => predicate(step) && step.status === 'completed');
}

function hasActiveStep(steps: TraceStep[], predicate: (step: TraceStep) => boolean): boolean {
  return steps.some((step) => predicate(step) && (step.status === 'running' || step.status === 'pending'));
}

function stepStatus(done: boolean, active: boolean): DocumentWorkshopStepStatus {
  if (done) {
    return 'done';
  }
  return active ? 'active' : 'pending';
}

function linkStatus(done: boolean, active: boolean): DocumentWorkshopStepStatus {
  return stepStatus(done, active);
}

export function getDocumentWorkshopProgress(
  messages: Message[],
  traceSteps: TraceStep[],
  visibleArtifactCount: number
): DocumentWorkshopProgress {
  const corpus = textCorpus(messages, traceSteps);
  const sourceDone = hasWorkshopIntent(messages) || hasStep(traceSteps, isDocumentReadStep);
  const readDone = hasCompletedStep(traceSteps, isDocumentReadStep);
  const readActive = hasActiveStep(traceSteps, isDocumentReadStep);
  const questionsDone =
    assistantMessageMatches(messages, QUESTION_EXTRACTION_PATTERNS) ||
    hasCompletedStep(traceSteps, isQuestionExtractionStep);
  const questionsActive = hasActiveStep(traceSteps, isQuestionExtractionStep);
  const imagesDone = hasCompletedStep(traceSteps, isDocumentImageExtractionStep);
  const imagesActive = hasActiveStep(traceSteps, isDocumentImageExtractionStep);
  const ocrDone =
    assistantMessageMatches(messages, OCR_ANALYSIS_PATTERNS) ||
    hasCompletedStep(traceSteps, isOcrAnalysisStep);
  const ocrActive = hasActiveStep(traceSteps, isOcrAnalysisStep);
  const contextDone =
    assistantMessageMatches(messages, FUNCTIONAL_CONTEXT_PATTERNS) ||
    hasCompletedStep(traceSteps, isFunctionalContextStep) ||
    imagesDone ||
    ocrDone;
  const contextActive =
    hasActiveStep(traceSteps, isFunctionalContextStep) ||
    imagesActive ||
    ocrActive;
  const deliverableDone = hasCompletedStep(traceSteps, isDocumentGenerationStep);
  const deliverableMessageDone = assistantMessageMatches(messages, DELIVERABLE_GENERATION_PATTERNS);
  const deliverableActive = hasActiveStep(traceSteps, isDocumentGenerationStep);
  const answersDone =
    assistantMessageMatches(messages, ANSWER_GENERATION_PATTERNS) ||
    hasCompletedStep(traceSteps, isAnswerGenerationStep) ||
    deliverableDone ||
    deliverableMessageDone;
  const answersActive = hasActiveStep(traceSteps, isAnswerGenerationStep);
  const artifactsDone = visibleArtifactCount > 0 && (imagesDone || deliverableDone || deliverableMessageDone);
  const artifactsActive = (imagesActive || deliverableActive) && visibleArtifactCount === 0;
  const traceabilityDone =
    assistantMessageMatches(messages, TRACEABILITY_COMPLETE_PATTERNS) ||
    hasCompletedStep(traceSteps, isTraceabilityCompleteStep);
  const imageEvidenceCount = countImageEvidence(corpus);
  const traceEvidence: DocumentWorkshopTraceEvidence = {
    questionCount: countQuestionReferences(corpus),
    imageCount: imageEvidenceCount > 0 ? imageEvidenceCount : imagesDone ? visibleArtifactCount : 0,
    ocrEvidenceCount: countOcrEvidence(corpus),
    bindingCount: countQuestionEvidenceBindings(corpus),
    artifactCount: visibleArtifactCount,
  };
  const visible =
    sourceDone ||
    readDone ||
    readActive ||
    contextDone ||
    contextActive ||
    questionsDone ||
    questionsActive ||
    imagesDone ||
    imagesActive ||
    ocrDone ||
    ocrActive ||
    answersDone ||
    answersActive ||
    deliverableDone ||
    deliverableMessageDone ||
    deliverableActive ||
    traceabilityDone ||
    visibleArtifactCount > 0;

  const steps: DocumentWorkshopStep[] = [
    { id: 'source', status: stepStatus(sourceDone, false) },
    { id: 'read', status: stepStatus(readDone, readActive) },
    { id: 'context', status: stepStatus(contextDone, contextActive) },
    { id: 'questions', status: stepStatus(questionsDone, questionsActive) },
    { id: 'images', status: stepStatus(imagesDone, imagesActive) },
    { id: 'ocr', status: stepStatus(ocrDone, ocrActive) },
    { id: 'answers', status: stepStatus(answersDone, answersActive) },
    { id: 'deliverable', status: stepStatus(deliverableDone || deliverableMessageDone, deliverableActive) },
    { id: 'artifacts', status: stepStatus(artifactsDone, artifactsActive) },
  ];
  const traceLinks: DocumentWorkshopTraceLink[] = [
    {
      id: 'questionContext',
      status: linkStatus(
        traceabilityDone || (questionsDone && contextDone),
        questionsActive || contextActive || questionsDone || contextDone
      ),
    },
    {
      id: 'ocrEvidence',
      status: linkStatus(
        traceabilityDone || (imagesDone && ocrDone),
        imagesActive || ocrActive || imagesDone || ocrDone
      ),
    },
    {
      id: 'answerEvidence',
      status: linkStatus(
        traceabilityDone || (answersDone && (questionsDone || contextDone || ocrDone)),
        answersActive || answersDone || questionsDone || contextDone || ocrDone
      ),
    },
    {
      id: 'deliverableEvidence',
      status: linkStatus(
        traceabilityDone || ((deliverableDone || deliverableMessageDone) && artifactsDone),
        deliverableActive ||
          artifactsActive ||
          deliverableDone ||
          deliverableMessageDone ||
          artifactsDone
      ),
    },
  ];
  const todos: DocumentWorkshopTodo[] = visible
    ? [
        ...steps.filter((step): step is DocumentWorkshopTodo => step.status === 'active'),
        ...steps.filter((step): step is DocumentWorkshopTodo => step.status === 'pending'),
      ].slice(0, 3)
    : [];

  return {
    visible,
    completedCount: steps.filter((step) => step.status === 'done').length,
    totalCount: steps.length,
    steps,
    todos,
    traceLinks,
    traceCompletedCount: traceLinks.filter((link) => link.status === 'done').length,
    traceTotalCount: traceLinks.length,
    traceEvidence,
  };
}

export function buildDocumentWorkshopMemoryContent(
  progress: DocumentWorkshopProgress,
  artifacts: DocumentWorkshopMemoryArtifact[]
): string {
  const completedSteps = progress.steps
    .filter((step) => step.status === 'done')
    .map((step) => STEP_MEMORY_LABELS[step.id]);
  const activeSteps = progress.todos
    .filter((todo) => todo.status === 'active')
    .map((todo) => STEP_MEMORY_LABELS[todo.id]);
  const nextSteps = progress.todos.map((todo) => STEP_MEMORY_LABELS[todo.id]);
  const completedLinks = progress.traceLinks
    .filter((link) => link.status === 'done')
    .map((link) => TRACE_MEMORY_LABELS[link.id]);
  const activeLinks = progress.traceLinks
    .filter((link) => link.status === 'active')
    .map((link) => TRACE_MEMORY_LABELS[link.id]);
  const generatedArtifacts = artifacts
    .filter((artifact) => artifact.role === 'generated' || artifact.path.toLowerCase().endsWith('.docx'))
    .slice(0, 5);
  const sourceAssets = artifacts
    .filter((artifact) => artifact.role === 'extracted')
    .slice(0, 5);

  const lines = [
    'Word workshop memory',
    `Progress: ${progress.completedCount}/${progress.totalCount}`,
  ];

  if (completedSteps.length > 0) {
    lines.push(`Completed: ${completedSteps.join(', ')}`);
  }
  if (activeSteps.length > 0) {
    lines.push(`Active now: ${activeSteps.join(', ')}`);
  }
  if (nextSteps.length > 0) {
    lines.push(`Next actions: ${nextSteps.join(', ')}`);
  }
  lines.push(
    `Evidence counts: questions ${progress.traceEvidence.questionCount}, images ${progress.traceEvidence.imageCount}, OCR ${progress.traceEvidence.ocrEvidenceCount}, bindings ${progress.traceEvidence.bindingCount}, artifacts ${progress.traceEvidence.artifactCount}`
  );
  if (completedLinks.length > 0) {
    lines.push(`Traceability completed: ${completedLinks.join(', ')}`);
  }
  if (activeLinks.length > 0) {
    lines.push(`Traceability in progress: ${activeLinks.join(', ')}`);
  }
  if (generatedArtifacts.length > 0) {
    lines.push(
      'Generated deliverables:',
      ...generatedArtifacts.map((artifact) => formatArtifactMemoryLine(artifact))
    );
  }
  if (sourceAssets.length > 0) {
    lines.push(
      'Source analysis assets:',
      ...sourceAssets.map((artifact) => formatArtifactMemoryLine(artifact))
    );
  }

  return lines.join('\n');
}

export function buildDocumentWorkshopEvidenceChips(
  progress: DocumentWorkshopProgress
): DocumentWorkshopEvidenceChip[] {
  const entries: Array<[DocumentWorkshopEvidenceChipId, number]> = [
    ['questions', progress.traceEvidence.questionCount],
    ['images', progress.traceEvidence.imageCount],
    ['ocr', progress.traceEvidence.ocrEvidenceCount],
    ['bindings', progress.traceEvidence.bindingCount],
    ['artifacts', progress.traceEvidence.artifactCount],
  ];

  return entries.map(([id, count]) => ({
    id,
    count,
    observed: count > 0,
  }));
}

export function getDocumentWorkshopReadiness(
  progress: DocumentWorkshopProgress,
  artifacts?: DocumentWorkshopMemoryArtifact[]
): DocumentWorkshopReadiness {
  const requiredStepIds: DocumentWorkshopStepId[] = [
    'source',
    'read',
    'context',
    'questions',
    'answers',
    'deliverable',
    'artifacts',
  ];
  const missingStepIds = requiredStepIds.filter((id) =>
    progress.steps.some((step) => step.id === id && step.status !== 'done')
  );
  const missingTraceLinkIds = progress.traceLinks
    .filter((link) => link.status !== 'done')
    .map((link) => link.id);
  const hasActiveWork =
    progress.steps.some((step) => step.status === 'active') ||
    progress.traceLinks.some((link) => link.status === 'active');
  const hasMinimumEvidence =
    progress.traceEvidence.questionCount > 0 &&
    progress.traceEvidence.artifactCount > 0;
  const docxValidationObserved = hasDocxValidationEvidence(artifacts);
  const hasDocxValidation = artifacts === undefined || docxValidationObserved;

  if (
    missingStepIds.length === 0 &&
    missingTraceLinkIds.length === 0 &&
    hasMinimumEvidence &&
    hasDocxValidation
  ) {
    return { status: 'ready', missingStepIds, missingTraceLinkIds, docxValidationObserved };
  }

  return {
    status: hasActiveWork ? 'inProgress' : 'needsEvidence',
    missingStepIds,
    missingTraceLinkIds,
    docxValidationObserved,
  };
}

function hasDocxValidationEvidence(
  artifacts: DocumentWorkshopMemoryArtifact[] | undefined
): boolean {
  if (artifacts === undefined) return true;
  return artifacts.some((artifact) => {
    const pathValue = artifact.path.toLowerCase();
    const labelValue = artifact.label.toLowerCase();
    if (!pathValue.endsWith('.docx') && !labelValue.endsWith('.docx')) {
      return false;
    }
    const evidence = artifact.evidence;
    if (!evidence) return false;
    return [
      evidence.relationshipCount,
      evidence.mediaCount,
      evidence.mediaFileCount,
      evidence.imageCount,
      evidence.embeddedImageCount,
    ].some((count) => typeof count === 'number' && count > 0);
  });
}

function formatArtifactMemoryLine(artifact: DocumentWorkshopMemoryArtifact): string {
  const imageCount = artifact.evidence?.imageCount ?? artifact.evidence?.embeddedImageCount;
  const mediaCount = artifact.evidence?.mediaCount ?? artifact.evidence?.mediaFileCount;
  const evidence = artifact.evidence
    ? [
        typeof imageCount === 'number'
          ? `${imageCount} image(s)`
          : '',
        typeof mediaCount === 'number'
          ? `${mediaCount} media file(s)`
          : '',
      ].filter(Boolean).join(', ')
    : '';
  const suffix = evidence ? ` (${evidence})` : '';
  return `- ${artifact.label}: ${artifact.path}${suffix}`;
}
