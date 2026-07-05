export const CSV_ANALYZE_WIRING = {
  tool: 'csv_analyze',
  classFile: 'src/tools/csv-analyze-tool.ts',
  pureFile: 'src/tools/csv/csv-parse.ts',
  testFile: 'tests/tools/csv-analyze-tool.test.ts',
  suggestedKeywords: ['csv', 'table', 'tabular', 'columns', 'numeric stats', 'preview'],
  fleetSafe: true,
} as const;
