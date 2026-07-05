import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { CsvAnalyzeTool } from '../../src/tools/csv-analyze-tool.js';
import { inferColumnTypes, numericStats, parseCsv } from '../../src/tools/csv/csv-parse.js';

describe('csv_analyze parser and tool', () => {
  it('parses quoted commas, escaped quotes, empty fields, and newlines in fields', () => {
    const rows = parseCsv('name,note,score\nAlice,"hello, world",10\nBob,"line 1\nline 2",\nCara,"said ""yes""",20\n');

    expect(rows).toEqual([
      ['name', 'note', 'score'],
      ['Alice', 'hello, world', '10'],
      ['Bob', 'line 1\nline 2', ''],
      ['Cara', 'said "yes"', '20'],
    ]);
  });

  it('infers column types and computes numeric stats', () => {
    const rows = parseCsv('name,amount,date\nA,10,2026-01-01\nB,,2026-01-02\nC,20,2026-01-03\nD,30,\n');
    const columns = inferColumnTypes(rows);
    const stats = numericStats(rows.slice(1).map((row) => row[1] ?? ''));

    expect(columns.map((column) => column.type)).toEqual(['string', 'number', 'date']);
    expect(columns[1]).toMatchObject({ name: 'amount', nulls: 1, nonNulls: 3 });
    expect(stats).toMatchObject({ count: 3, nulls: 1, min: 10, max: 30, mean: 20, median: 20 });
  });

  it('analyzes a real CSV file and truncates preview rows', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'csv-analyze-tool-'));
    const csvPath = path.join(root, 'sample.csv');
    await fs.writeFile(csvPath, 'name,amount\nAlice,10\nBob,20\nCara,30\n', 'utf8');

    const result = await new CsvAnalyzeTool().execute({ path: csvPath, maxPreview: 2 });

    expect(result.success).toBe(true);
    expect(result.output).toContain('- Rows: 3');
    expect(result.output).toContain('| amount | number | 3 | 0 | 10 | 30 | 20 | 20 |');
    expect(result.output).toContain('Preview (2 of 3 rows)');
    expect(result.output).toContain('_Preview truncated: 1 more row(s)._');
    expect(result.output).not.toContain('| Cara | 30 |');
  });

  it('returns a clean error for malformed CSV instead of throwing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'csv-analyze-tool-'));
    const csvPath = path.join(root, 'bad.csv');
    await fs.writeFile(csvPath, 'name,note\nAlice,"unterminated\n', 'utf8');

    const result = await new CsvAnalyzeTool().execute({ path: csvPath });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Malformed CSV');
  });
});
