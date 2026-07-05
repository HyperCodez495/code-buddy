import { describe, expect, it } from 'vitest';

import { parseSheetRequest, rowsToCsv } from '../src/renderer/utils/sheet-schema';

describe('parseSheetRequest', () => {
  it('extracts video metrics from a natural-language request', () => {
    const schema = parseSheetRequest('top 20 vidéos IA avec vues, likes, durée et URL');

    expect(schema.source).toBe('YouTube / web');
    expect(schema.columns).toEqual(['Titre', 'Vues', 'Likes', 'Durée', 'URL']);
  });

  it('falls back to useful generic columns', () => {
    expect(parseSheetRequest('trouve des concurrents').columns).toEqual(['Titre', 'Résumé', 'Source']);
  });
});

describe('rowsToCsv', () => {
  it('serializes rows using the schema columns and escapes values', () => {
    const schema = { title: 'T', source: 'Web', columns: ['Name', 'Note'] };

    expect(rowsToCsv(schema, [['A, B', 'he said "yes"']])).toBe('Name,Note\r\n"A, B","he said ""yes"""');
  });

  it('pads missing cells', () => {
    const schema = { title: 'T', source: 'Web', columns: ['A', 'B', 'C'] };

    expect(rowsToCsv(schema, [['1']])).toBe('A,B,C\r\n1,,');
  });
});
