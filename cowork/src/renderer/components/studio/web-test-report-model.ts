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

/**
 * Parse the TEXT report of a web_test ToolResult (`output`), the only form the
 * renderer receives via trace steps (`toolOutput` — the structured `data` block
 * is not forwarded). Format emitted by `web-test-tool.ts report()`:
 *
 *   Web test PASSED — http://127.0.0.1:5173/
 *   ✓ navigation: loaded http://…
 *   ✗ console: 2 error(s): …
 *   Screenshot: /tmp/shot.png
 *
 * Returns null when the text isn't a web_test report.
 */
export function parseWebTestOutput(output: string | undefined): WebTestReport | null {
  if (!output) return null;
  const lines = output.split('\n');
  const head = lines[0]?.match(/^Web test (PASSED|FAILED) — (.+)$/);
  if (!head) return null;

  const checks: WebTestCheck[] = [];
  let screenshotPath: string | undefined;
  for (const line of lines.slice(1)) {
    const check = line.match(/^([✓✗]) ([^:]+): (.*)$/);
    if (check) {
      checks.push({ name: check[2]!, passed: check[1] === '✓', ...(check[3] ? { detail: check[3] } : {}) });
      continue;
    }
    const shot = line.match(/^Screenshot: (.+)$/);
    if (shot) screenshotPath = shot[1]!.trim();
  }

  const countFrom = (name: string, unit: RegExp): number => {
    const check = checks.find((c) => c.name === name);
    const n = check?.detail?.match(unit);
    return n ? Number(n[1]) : 0;
  };

  return {
    passed: head[1] === 'PASSED',
    url: head[2]!.trim(),
    checks,
    consoleErrorCount: countFrom('console', /^(\d+) error/),
    networkFailureCount: countFrom('network', /^(\d+) request/),
    ...(screenshotPath ? { screenshotPath } : {}),
  };
}

/**
 * The latest completed web_test report in a session's trace, if any — the
 * signal App Studio surfaces as the verification card.
 */
export function latestWebTestReport(
  steps: ReadonlyArray<{ type?: string; toolName?: string; toolOutput?: string }>,
): WebTestReport | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    if (step.toolName !== 'web_test' || !step.toolOutput) continue;
    const report = parseWebTestOutput(step.toolOutput);
    if (report) return report;
  }
  return null;
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
