/**
 * web_test — one-call structured UI test with EVIDENCE, for the
 * develop → launch → browse → verify loop.
 *
 * Orchestrates the shared browser session: navigate (through the same
 * navigation gate as every browser action — dev origins or safe URLs only),
 * collect console messages AND page errors (the client face of a bug),
 * pull the server-side log tail when the URL belongs to an app_server-managed
 * process (the server face), take an accessibility snapshot and a screenshot,
 * run declarative assertions, and return a single pass/fail report where
 * every check shows its evidence — the agent renders proof, not claims
 * (Replit's "no Potemkin interfaces" rule).
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { BrowserConsoleExecuteTool, BrowserExecuteTool, BrowserSnapshotExecuteTool } from './misc-tools.js';

export interface WebTestAssertion {
  /** 'text' = page text contains value; 'selector' = querySelector matches; 'title' = document.title contains value. */
  type: 'text' | 'selector' | 'title';
  value: string;
}

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

interface ConsoleEntry {
  type: string;
  text: string;
}

export class WebTestTool implements ITool {
  readonly name = 'web_test';
  readonly description =
    'Test a web page in one call: navigate, collect console errors + page errors + server logs (for app_server-managed URLs), snapshot, screenshot, run assertions, and return a structured pass/fail report with evidence. Use after building or changing a web UI.';

  private browser = new BrowserExecuteTool();
  private consoleTool = new BrowserConsoleExecuteTool();
  private snapshotTool = new BrowserSnapshotExecuteTool();

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const url = input.url as string;
    const assertions = (input.assertions as WebTestAssertion[] | undefined) ?? [];
    const wantScreenshot = input.screenshot !== false;
    const allowConsoleErrors = input.allowConsoleErrors === true;

    const checks: CheckResult[] = [];
    const push = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });

    // 1. Launch (idempotent) + fresh console buffer, then navigate through
    //    the standard gate.
    const launched = await this.browser.execute({ action: 'launch', headless: true });
    if (!launched.success) {
      return { success: false, error: `Browser launch failed: ${launched.error}` };
    }
    await this.consoleTool.execute({ action: 'clear' }).catch(() => {});

    const navigated = await this.browser.execute({ action: 'navigate', url, waitUntil: 'load' });
    push('navigation', navigated.success, navigated.success ? `loaded ${url}` : navigated.error ?? 'failed');
    if (!navigated.success) {
      return this.report(url, checks, { consoleEntries: [], serverLogs: await this.serverLogsFor(url) });
    }

    // Give late console errors (async boot code) a beat to land.
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 2. Client-side oracle: console + pageerror.
    const consoleEntries = await this.readConsole();
    const errors = consoleEntries.filter((entry) => entry.type === 'error' || entry.type === 'pageerror');
    push(
      'console',
      allowConsoleErrors || errors.length === 0,
      errors.length === 0 ? 'no console/page errors' : `${errors.length} error(s): ${errors.map((e) => e.text).slice(0, 5).join(' | ')}`,
    );

    // 3. Declarative assertions, each with its own evidence line.
    for (const assertion of assertions) {
      const result = await this.runAssertion(assertion);
      push(`assert ${assertion.type} "${assertion.value}"`, result.passed, result.detail);
    }

    // 4. Structure snapshot (numbered refs — the agent can interact next).
    const snapshot = await this.snapshotTool.execute({ interactiveOnly: true, maxElements: 15 });
    const snapshotSummary = snapshot.success ? (snapshot.output ?? '').split('\n').slice(0, 18).join('\n') : `snapshot failed: ${snapshot.error}`;

    // 5. Screenshot as reviewable evidence.
    let screenshotPath: string | undefined;
    if (wantScreenshot) {
      const shot = await this.browser.execute({ action: 'screenshot' });
      if (shot.success) {
        screenshotPath = ((shot.data as { path?: string } | undefined)?.path) ?? shot.output?.match(/saved to (\S+)/)?.[1];
      }
    }

    // 6. Server face of the bug, when we manage this origin.
    const serverLogs = await this.serverLogsFor(url);

    return this.report(url, checks, { consoleEntries, serverLogs, snapshotSummary, screenshotPath });
  }

  private async readConsole(): Promise<ConsoleEntry[]> {
    const listed = await this.consoleTool.execute({ action: 'list', limit: 50 });
    if (!listed.success) return [];
    const entries = (listed.data as { entries?: ConsoleEntry[] } | undefined)?.entries;
    return entries ?? [];
  }

  private async runAssertion(assertion: WebTestAssertion): Promise<{ passed: boolean; detail: string }> {
    const value = JSON.stringify(assertion.value);
    const expression =
      assertion.type === 'text'
        ? `document.body && document.body.innerText.includes(${value})`
        : assertion.type === 'selector'
          ? `!!document.querySelector(${value})`
          : `document.title.includes(${value})`;
    const result = await this.browser.execute({ action: 'evaluate', expression });
    if (!result.success) return { passed: false, detail: `evaluate failed: ${result.error}` };
    const passed = (result.data as { result?: unknown } | undefined)?.result === true;
    return { passed, detail: passed ? 'found' : 'NOT found' };
  }

  private async serverLogsFor(url: string): Promise<string | undefined> {
    try {
      const origin = new URL(url).origin;
      const { getAppServerTool } = await import('../app-server-tool.js');
      return getAppServerTool().logTailForOrigin(origin) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private report(
    url: string,
    checks: CheckResult[],
    extra: { consoleEntries: ConsoleEntry[]; serverLogs?: string; snapshotSummary?: string; screenshotPath?: string },
  ): ToolResult {
    const passed = checks.every((check) => check.passed);
    const lines: string[] = [
      `Web test ${passed ? 'PASSED' : 'FAILED'} — ${url}`,
      ...checks.map((check) => `${check.passed ? '✓' : '✗'} ${check.name}: ${check.detail}`),
    ];
    if (extra.screenshotPath) lines.push(`Screenshot: ${extra.screenshotPath}`);
    if (extra.snapshotSummary) lines.push('', 'Interactive elements:', extra.snapshotSummary);
    if (extra.serverLogs) lines.push('', 'Server logs (app_server):', extra.serverLogs);
    if (!passed) lines.push('', 'Fix the failures above, then re-run web_test to verify.');

    return {
      // The tool ran; the verdict lives in data.passed and the report. A
      // failing test is a SUCCESSFUL test run — the agent must read it.
      success: true,
      output: lines.join('\n'),
      data: {
        passed,
        url,
        checks,
        consoleErrorCount: extra.consoleEntries.filter((e) => e.type === 'error' || e.type === 'pageerror').length,
        screenshotPath: extra.screenshotPath,
      },
    };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Page to test — a dev origin registered via app_server, or any safe public URL',
          },
          assertions: {
            type: 'array',
            description: 'Declarative checks, each rendered with evidence in the report',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['text', 'selector', 'title'] },
                value: { type: 'string' },
              },
              required: ['type', 'value'],
            },
          },
          screenshot: {
            type: 'boolean',
            description: 'Capture a screenshot as evidence (default true)',
          },
          allowConsoleErrors: {
            type: 'boolean',
            description: 'Do not fail the test on console/page errors (default false)',
          },
        },
        required: ['url'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.url !== 'string' || data.url.trim() === '') {
      return { valid: false, errors: ['url is required'] };
    }
    if (data.assertions !== undefined && !Array.isArray(data.assertions)) {
      return { valid: false, errors: ['assertions must be an array'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['test', 'ui test', 'web test', 'verify', 'check app', 'e2e', 'smoke test', 'console errors'],
      priority: 7,
      requiresConfirmation: true,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }

  dispose(): void {
    // Browser lifecycle belongs to the shared manager.
  }
}
