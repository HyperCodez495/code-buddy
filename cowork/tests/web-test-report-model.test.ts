/**
 * web-test-report-model — real test (no mocks): parse a web_test ToolResult data
 * block, summarize, and reject malformed input.
 */
import { describe, expect, it } from 'vitest';
import {
  latestWebTestReport,
  parseWebTestOutput,
  parseWebTestResult,
  summarizeReport,
} from '../src/renderer/components/studio/web-test-report-model';

describe('parseWebTestResult', () => {
  it('parses a real web_test data block', () => {
    const report = parseWebTestResult({
      passed: false,
      url: 'http://localhost:5173/',
      checks: [
        { name: 'navigation', passed: true, detail: 'loaded' },
        { name: 'console errors', passed: false, detail: '2 errors' },
        { name: 'bad', passed: 'nope' }, // invalid → dropped
      ],
      consoleErrorCount: 2,
      networkFailureCount: 0,
      screenshotPath: '/tmp/shot.png',
    });
    expect(report).not.toBeNull();
    expect(report!.passed).toBe(false);
    expect(report!.url).toBe('http://localhost:5173/');
    expect(report!.checks).toHaveLength(2);
    expect(report!.consoleErrorCount).toBe(2);
    expect(report!.screenshotPath).toBe('/tmp/shot.png');
  });

  it('returns null for non-web_test data', () => {
    expect(parseWebTestResult(null)).toBeNull();
    expect(parseWebTestResult({ foo: 1 })).toBeNull();
    expect(parseWebTestResult({ passed: 'yes', url: 'x' })).toBeNull();
  });

  it('defaults missing counts to 0 and tolerates no screenshot', () => {
    const r = parseWebTestResult({ passed: true, url: 'http://127.0.0.1:3000/', checks: [] })!;
    expect(r.consoleErrorCount).toBe(0);
    expect(r.networkFailureCount).toBe(0);
    expect(r.screenshotPath).toBeUndefined();
  });
});

describe('parseWebTestOutput', () => {
  // Verbatim shape of web-test-tool.ts report() — the only form the renderer sees.
  const realOutput = [
    'Web test FAILED — http://127.0.0.1:5173/',
    '✓ navigation: loaded http://127.0.0.1:5173/',
    '✗ console: 2 error(s): TypeError: x is undefined | ReferenceError: y',
    '✗ network: 1 request(s) failed: - GET /api/data → 500',
    '✓ assert text "Todo": found',
    'Screenshot: /tmp/codebuddy-shot.png',
    '',
    'Interactive elements:',
    '[1] button "Ajouter"',
    '',
    'Fix the failures above, then re-run web_test to verify.',
  ].join('\n');

  it('parses the real text report emitted by web-test-tool', () => {
    const r = parseWebTestOutput(realOutput)!;
    expect(r.passed).toBe(false);
    expect(r.url).toBe('http://127.0.0.1:5173/');
    expect(r.checks.map((c) => c.name)).toEqual(['navigation', 'console', 'network', 'assert text "Todo"']);
    expect(r.checks[1]!.passed).toBe(false);
    expect(r.consoleErrorCount).toBe(2);
    expect(r.networkFailureCount).toBe(1);
    expect(r.screenshotPath).toBe('/tmp/codebuddy-shot.png');
  });

  it('parses a passing report with zero counts', () => {
    const r = parseWebTestOutput(
      'Web test PASSED — http://localhost:3000/\n✓ navigation: loaded\n✓ console: no console/page errors\n✓ network: no failed requests',
    )!;
    expect(r.passed).toBe(true);
    expect(r.consoleErrorCount).toBe(0);
    expect(r.networkFailureCount).toBe(0);
    expect(r.screenshotPath).toBeUndefined();
  });

  it('returns null on non-report text and empty input', () => {
    expect(parseWebTestOutput('Command completed successfully')).toBeNull();
    expect(parseWebTestOutput('')).toBeNull();
    expect(parseWebTestOutput(undefined)).toBeNull();
  });
});

describe('latestWebTestReport', () => {
  it('picks the LAST parseable web_test step in the trace', () => {
    const steps = [
      { toolName: 'web_test', toolOutput: 'Web test FAILED — http://a/\n✗ console: 1 error(s): boom' },
      { toolName: 'str_replace', toolOutput: 'edited' },
      { toolName: 'web_test', toolOutput: 'Web test PASSED — http://a/\n✓ console: no console/page errors' },
    ];
    const r = latestWebTestReport(steps)!;
    expect(r.passed).toBe(true);
  });

  it('returns null when no web_test ran', () => {
    expect(latestWebTestReport([{ toolName: 'bash', toolOutput: 'ok' }])).toBeNull();
    expect(latestWebTestReport([])).toBeNull();
  });
});

describe('summarizeReport', () => {
  it('counts failed checks and picks a tone', () => {
    const s = summarizeReport({
      passed: false,
      url: 'u',
      checks: [
        { name: 'a', passed: true },
        { name: 'b', passed: false },
        { name: 'c', passed: false },
      ],
      consoleErrorCount: 1,
      networkFailureCount: 0,
    });
    expect(s).toEqual({ passed: false, failed: 2, total: 3, tone: 'danger' });
  });

  it('is success when passed', () => {
    expect(summarizeReport({ passed: true, url: 'u', checks: [], consoleErrorCount: 0, networkFailureCount: 0 }).tone).toBe('success');
  });
});
