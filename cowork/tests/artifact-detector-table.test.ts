import { describe, expect, it } from 'vitest';

import { detectArtifacts, detectTables } from '../src/renderer/utils/artifact-detector';

describe('detectTables', () => {
  it('parses a standalone GFM table into headers + rows', () => {
    const md = [
      'Voici les résultats:',
      '',
      '| Modèle | Score | Coût |',
      '| --- | --- | --- |',
      '| GPT-5 | 92 | 0.03 |',
      '| Claude | 95 | 0.05 |',
      '',
      'Fin.',
    ].join('\n');

    const tables = detectTables(md);
    expect(tables).toHaveLength(1);
    expect(tables[0]?.headers).toEqual(['Modèle', 'Score', 'Coût']);
    expect(tables[0]?.rows).toEqual([
      ['GPT-5', '92', '0.03'],
      ['Claude', '95', '0.05'],
    ]);
  });

  it('picks up a title from a preceding heading', () => {
    const md = [
      '### Comparatif',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n');
    expect(detectTables(md)[0]?.title).toBe('Comparatif');
  });

  it('ignores prose that merely contains a stray pipe', () => {
    const md = 'Le prix est de 10 | 20 euros selon la formule choisie.';
    expect(detectTables(md)).toHaveLength(0);
  });

  it('skips a one-column "table"', () => {
    const md = ['| Item |', '| --- |', '| a |', '| b |'].join('\n');
    expect(detectTables(md)).toHaveLength(0);
  });

  it('normalizes ragged rows to the header column count', () => {
    const md = [
      '| A | B | C |',
      '| --- | --- | --- |',
      '| 1 | 2 |',
      '| x | y | z | extra |',
    ].join('\n');
    const t = detectTables(md)[0];
    expect(t?.rows).toEqual([
      ['1', '2', ''],
      ['x', 'y', 'z'],
    ]);
  });

  it('surfaces a table artifact through detectArtifacts', () => {
    const md = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    const artifacts = detectArtifacts(md);
    const table = artifacts.find((a) => a.kind === 'table');
    expect(table).toBeDefined();
    expect(table?.table?.headers).toEqual(['A', 'B']);
    expect(table?.source).toContain('| A | B |');
  });
});
