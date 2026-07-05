import { describe, expect, it } from 'vitest';

import { compareTableCells, sortTableRows, tableToCsv } from '../src/renderer/utils/table-csv';

describe('tableToCsv', () => {
  it('escapes fields containing commas, quotes and newlines', () => {
    const csv = tableToCsv(
      ['name', 'note'],
      [['x,y', 'he said "hi"'], ['plain', 'line1\nline2']]
    );
    expect(csv).toBe(
      ['name,note', '"x,y","he said ""hi"""', 'plain,"line1\nline2"'].join('\r\n')
    );
  });

  it('leaves simple fields unquoted', () => {
    expect(tableToCsv(['a', 'b'], [['1', '2']])).toBe('a,b\r\n1,2');
  });
});

describe('compareTableCells', () => {
  it('orders numeric cells numerically, not lexically', () => {
    expect(compareTableCells('2', '10')).toBeLessThan(0);
    expect(compareTableCells('10', '2')).toBeGreaterThan(0);
  });

  it('tolerates currency / percent / thousands separators', () => {
    expect(compareTableCells('1,200', '900')).toBeGreaterThan(0);
    expect(compareTableCells('5%', '12%')).toBeLessThan(0);
  });

  it('sorts numbers before free-text strings', () => {
    expect(compareTableCells('3', 'alpha')).toBeLessThan(0);
    expect(compareTableCells('alpha', '3')).toBeGreaterThan(0);
  });
});

describe('sortTableRows', () => {
  const rows = [
    ['Claude', '95'],
    ['GPT-5', '92'],
    ['Local', '80'],
  ];

  it('sorts ascending by a numeric column without mutating input', () => {
    const sorted = sortTableRows(rows, 1, 'asc');
    expect(sorted.map((r) => r[1])).toEqual(['80', '92', '95']);
    // original untouched
    expect(rows[0]?.[1]).toBe('95');
  });

  it('sorts descending by a string column', () => {
    const sorted = sortTableRows(rows, 0, 'desc');
    expect(sorted.map((r) => r[0])).toEqual(['Local', 'GPT-5', 'Claude']);
  });
});
