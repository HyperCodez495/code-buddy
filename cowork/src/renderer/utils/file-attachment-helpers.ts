import type { ContentBlock } from '../types';

export interface AttachedFile {
  name: string;
  path: string;
  size: number;
  type: string;
  inlineDataBase64?: string;
}

export interface PastedImageAttachment {
  url?: string;
  base64: string;
  mediaType: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  json: 'application/json',
  log: 'text/plain',
  md: 'text/markdown',
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rst: 'text/plain',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  zip: 'application/zip',
};

export function getFileNameFromPath(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || 'unknown';
}

export function inferAttachmentMimeType(name: string, providedType?: string): string {
  if (providedType && providedType !== 'application/octet-stream') {
    return providedType;
  }
  const extension = name.toLowerCase().match(/\.([^.]+)$/)?.[1];
  return extension
    ? (MIME_BY_EXTENSION[extension] ?? 'application/octet-stream')
    : 'application/octet-stream';
}

export function buildAttachmentFromPath(filePath: string): AttachedFile {
  const name = getFileNameFromPath(filePath);
  return {
    name,
    path: filePath,
    size: 0,
    type: inferAttachmentMimeType(name),
  };
}

export function hasDocumentWorkshopAttachment(
  file: Pick<AttachedFile, 'name' | 'type'>
): boolean {
  const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? '';
  return (
    extension === 'docx' ||
    extension === 'pdf' ||
    file.type === 'application/pdf' ||
    file.type.includes('wordprocessingml')
  );
}

export function buildDocumentWorkshopPrompt(files: Array<Pick<AttachedFile, 'name'>>): string {
  const names = files.map((file) => file.name).filter(Boolean).join(', ');
  const target = names || 'les documents attaches';

  return [
    `Analyse les documents attaches (${target}) comme un atelier Word complet.`,
    'Extrais toutes les questions, conserve le contexte fonctionnel qui les precede, exploite les tableaux et les captures ecran, puis reponds question par question.',
    'Reprends dans le livrable le contexte fonctionnel situe avant chaque question, y compris les captures et tableaux qui expliquent la question.',
    'Tiens un registre Question | Contexte source | Capture/OCR | Reponse pour rendre la trace visible.',
    'Quand les captures sont utiles, extrais les images, fais l OCR si necessaire, et insere les captures pertinentes dans le livrable final avec leurs references.',
    'Annonce les jalons "Contexte fonctionnel capture", "Questions extraites", "OCR termine" et "Reponses preparees" quand ces etapes sont faites pour afficher l avancement.',
    'Annonce "Traceabilite atelier complete" quand les liens Question | Contexte | Capture/OCR | Reponse sont prets pour le livrable.',
    'Valide le DOCX final avant de le presenter comme pret, notamment les relations, medias integres et chemins de sortie compatibles Word.',
    'Garde les controles qualite en interne et n ajoute pas de score qualite numerique visible comme "Score qualite 0/100" dans le livrable.',
    'Genere ensuite un document DOCX technique complet avec les questions, les reponses detaillees, les preuves, les impacts, les limites et les sources.',
  ].join(' ');
}

export function getDocumentWorkshopSubmissionPrompt(
  prompt: string,
  files: Array<Pick<AttachedFile, 'name' | 'type'>>
): string {
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt) {
    return trimmedPrompt;
  }

  return files.some(hasDocumentWorkshopAttachment) ? buildDocumentWorkshopPrompt(files) : '';
}

export function buildComposerContentBlocks(
  prompt: string,
  attachedFiles: AttachedFile[],
  pastedImages: PastedImageAttachment[]
): ContentBlock[] {
  const contentBlocks: ContentBlock[] = [];
  const submissionPrompt = getDocumentWorkshopSubmissionPrompt(prompt, attachedFiles);

  pastedImages.forEach((img) => {
    contentBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: img.base64,
      },
    });
  });

  attachedFiles.forEach((file) => {
    contentBlocks.push({
      type: 'file_attachment',
      filename: file.name,
      relativePath: file.path,
      size: file.size,
      mimeType: file.type,
      inlineDataBase64: file.inlineDataBase64,
    });
  });

  if (submissionPrompt) {
    contentBlocks.push({
      type: 'text',
      text: submissionPrompt,
    });
  }

  return contentBlocks;
}

export function getDroppedFilePath(file: File): string {
  return 'path' in file && typeof file.path === 'string' ? file.path : '';
}

export function isDroppedFolderCandidate(file: File): boolean {
  const filePath = getDroppedFilePath(file);
  return !file.type && Boolean(filePath) && !file.name.includes('.');
}

export async function buildAttachmentFromDroppedFile(
  file: File,
  blobToBase64: (blob: Blob) => Promise<string>
): Promise<AttachedFile> {
  const droppedPath = getDroppedFilePath(file);
  const inlineDataBase64 = droppedPath ? undefined : await blobToBase64(file);

  return {
    name: file.name,
    path: droppedPath,
    size: file.size,
    type: inferAttachmentMimeType(file.name, file.type),
    inlineDataBase64,
  };
}
