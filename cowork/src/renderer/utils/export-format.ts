/**
 * Pure export format helpers for deliverable sharing surfaces.
 *
 * @module renderer/utils/export-format
 */

export type ExportFormat = 'pdf' | 'markdown' | 'docx' | 'pptx' | 'xlsx' | 'png' | 'link';

export interface DeliverableRef {
  id: string;
  title: string;
  kind: 'deck' | 'sheet' | 'doc' | 'page' | 'image' | 'report' | 'podcast' | 'video';
}

export const EXPORT_FORMATS: ExportFormat[] = ['pdf', 'markdown', 'docx', 'pptx', 'xlsx', 'png', 'link'];

const EXTENSIONS: Record<ExportFormat, string> = {
  pdf: 'pdf',
  markdown: 'md',
  docx: 'docx',
  pptx: 'pptx',
  xlsx: 'xlsx',
  png: 'png',
  link: 'url',
};

const MIMES: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  markdown: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  link: 'text/uri-list',
};

function slugify(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'deliverable';
}

export function filenameFor(deliverable: DeliverableRef, format: ExportFormat): string {
  return `${slugify(deliverable.title)}.${EXTENSIONS[format]}`;
}

export function mimeFor(format: ExportFormat): string {
  return MIMES[format];
}
