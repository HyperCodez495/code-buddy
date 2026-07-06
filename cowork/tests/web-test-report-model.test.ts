/**
 * web-test-report-model — real test (no mocks): parse a web_test ToolResult data
 * block, summarize, and reject malformed input.
 */
import { describe, expect, it } from 'vitest';
import { parseWebTestResult, summarizeReport } from '../src/renderer/components/studio/web-test-report-model';

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
