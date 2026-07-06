/**
 * Parse + summarize a Code Buddy `web_test` tool result for display in the App
 * Studio workbench (the app-verification report). Pure + structurally typed.
 */
export interface WebTestCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface WebTestReport {
  passed: boolean;
  url: string;
  checks: WebTestCheck[];
  consoleErrorCount: number;
  networkFailureCount: number;
  screenshotPath?: string;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Parse the `data` block of a web_test ToolResult; null if it isn't one. */
export function parseWebTestResult(data: unknown): WebTestReport | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.passed !== 'boolean' || typeof d.url !== 'string') return null;

  const rawChecks = Array.isArray(d.checks) ? d.checks : [];
  const checks: WebTestCheck[] = rawChecks
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      if (typeof o.name !== 'string' || typeof o.passed !== 'boolean') return null;
      return {
        name: o.name,
        passed: o.passed,
        ...(typeof o.detail === 'string' && o.detail ? { detail: o.detail } : {}),
      };
    })
    .filter((c): c is WebTestCheck => c !== null);

  return {
    passed: d.passed,
    url: d.url,
    checks,
    consoleErrorCount: num(d.consoleErrorCount),
    networkFailureCount: num(d.networkFailureCount),
    ...(typeof d.screenshotPath === 'string' && d.screenshotPath ? { screenshotPath: d.screenshotPath } : {}),
  };
}

export interface ReportSummary {
  passed: boolean;
  failed: number;
  total: number;
  tone: 'success' | 'danger';
}

export function summarizeReport(r: WebTestReport): ReportSummary {
  const failed = r.checks.filter((c) => !c.passed).length;
  return {
    passed: r.passed,
    failed,
    total: r.checks.length,
    tone: r.passed ? 'success' : 'danger',
  };
}
