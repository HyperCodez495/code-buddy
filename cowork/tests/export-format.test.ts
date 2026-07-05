import { describe, expect, it } from 'vitest';

import { filenameFor, mimeFor, type DeliverableRef } from '../src/renderer/utils/export-format';

const deliverable: DeliverableRef = {
  id: 'd1',
  title: 'Rapport marché IA 2026',
  kind: 'report',
};

describe('filenameFor', () => {
  it('creates safe filenames with the requested extension', () => {
    expect(filenameFor(deliverable, 'pdf')).toBe('rapport-marche-ia-2026.pdf');
    expect(filenameFor(deliverable, 'markdown')).toBe('rapport-marche-ia-2026.md');
  });

  it('falls back for blank titles', () => {
    expect(filenameFor({ ...deliverable, title: '   ' }, 'png')).toBe('deliverable.png');
  });
});

describe('mimeFor', () => {
  it('returns mime types for export formats', () => {
    expect(mimeFor('xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(mimeFor('link')).toBe('text/uri-list');
  });
});
