import fs from 'fs';
import path from 'path';
import type { BrowserOperatorSessionDraft, BrowserOperatorActionLogEntry } from './browser-operator-session.js';
import { buildBrowserOperatorHarnessBundle } from './browser-operator-harness.js';
import { logger } from '../utils/logger.js';
import { ConfirmationService } from '../utils/confirmation-service.js';

const INIT_TIMEOUT_MS = 30_000;
const NAVIGATION_TIMEOUT_MS = 60_000;
const ACTION_TIMEOUT_MS = 45_000;
const EXTRACT_TIMEOUT_MS = 60_000;
const WATCHDOG_INTERVAL_MS = 3_000;

type StagehandPage = Record<string, any>;
type StagehandContext = Record<string, any>;
type StagehandInstance = {
  page?: StagehandPage;
  context?: StagehandContext;
  init: () => Promise<void>;
  close: () => Promise<void>;
  act?: (instruction: string, options?: Record<string, unknown>) => Promise<unknown>;
  extract?: (...args: unknown[]) => Promise<unknown>;
  observe?: (...args: unknown[]) => Promise<unknown>;
};

interface BrowserActionResult {
  evidence: string;
  artifactPath?: string;
}

interface ResolvedBrowserElement {
  selector: string;
  description: string;
  method?: string;
  arguments?: string[];
  source: 'stagehand-observe' | 'dom-heuristic';
}

type GuardedResult<T> =
  | { kind: 'value'; value: T }
  | { kind: 'error'; error: unknown }
  | { kind: 'checkpoint' }
  | { kind: 'timeout' };

const MUTATING_ACTIONS = new Set([
  'act',
  'click',
  'double_click',
  'right_click',
  'type',
  'fill',
  'select',
  'press',
  'hover',
  'drag',
  'upload_files',
  'download',
  'set_cookie',
  'clear_cookies',
  'set_local_storage',
  'set_session_storage',
  'set_headers',
  'set_offline',
  'set_geolocation',
]);

const BROWSER_ACTIONS = new Set([
  'navigate',
  'go_back',
  'go_forward',
  'reload',
  'observe',
  'extract',
  'identify_element',
  'resolve_element',
  'assert_text',
  'act',
  'click',
  'double_click',
  'right_click',
  'type',
  'fill',
  'select',
  'press',
  'hover',
  'scroll',
  'evaluate',
  'get_content',
  'get_text',
  'get_url',
  'get_title',
  'screenshot',
  'wait',
  'wait_for_selector',
  'wait_for_navigation',
  'get_cookies',
  'set_cookie',
  'clear_cookies',
  'get_local_storage',
  'set_local_storage',
  'get_session_storage',
  'set_session_storage',
  'upload_files',
  'download',
  'tabs',
  'new_tab',
  'focus_tab',
  'close_tab',
]);

export class SecurityCheckpointDetected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityCheckpointDetected';
  }
}

export class BrowserOperatorExecutor {
  private session: BrowserOperatorSessionDraft;
  private stagehand: StagehandInstance | null = null;
  private page: StagehandPage | null = null;
  private isStopped = false;

  constructor(session: BrowserOperatorSessionDraft) {
    this.session = session;
  }

  /**
   * Grant consent for the session.
   */
  grantConsent(reviewer: string = 'human-operator'): void {
    this.session.consent.granted = true;
    this.session.consent.grantedBy = reviewer;
    this.session.consent.grantedAt = new Date().toISOString();
    logger.info(`BrowserOperatorExecutor: Consent granted for session ${this.session.sessionId} by ${reviewer}`);
  }

  /**
   * Stop the session execution.
   */
  stop(): void {
    this.isStopped = true;
    logger.info(`BrowserOperatorExecutor: Stop signal received for session ${this.session.sessionId}`);
  }

  /**
   * Run the planned browser actions sequentially.
   */
  async execute(cwd: string = process.cwd()): Promise<{ success: boolean; stopped: boolean; actionLog: BrowserOperatorActionLogEntry[] }> {
    if (!this.session.consent.granted) {
      logger.error('BrowserOperatorExecutor: Execution blocked. Consent required.');
      throw new Error('BrowserOperatorConsentRequired: Execution blocked. Local browser operator requires human consent.');
    }

    logger.info(`BrowserOperatorExecutor: Starting execution for session ${this.session.sessionId} (mode: ${this.session.mode})`);

    const checkpointListeners = new Set<() => void>();
    let watchdogInterval: NodeJS.Timeout | null = null;
    let checkpointDetected = false;
    let checkpointReason = '';

    const raiseCheckpoint = (reason: string) => {
      logger.error(`[BrowserWatchdog] ${reason}`);
      this.isStopped = true;
      checkpointDetected = true;
      checkpointReason = reason;
      if (watchdogInterval) {
        clearInterval(watchdogInterval);
        watchdogInterval = null;
      }
      for (const listener of checkpointListeners) {
        listener();
      }
      checkpointListeners.clear();
    };

    const runGuarded = async <T>(
      label: string,
      timeoutMs: number,
      operation: () => Promise<T>,
    ): Promise<T> => {
      if (checkpointDetected) {
        throw new SecurityCheckpointDetected(checkpointReason);
      }

      let checkpointListener: (() => void) | null = null;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const operationPromise: Promise<GuardedResult<T>> = Promise.resolve()
        .then(operation)
        .then((value) => ({ kind: 'value' as const, value }))
        .catch((error) => ({ kind: 'error' as const, error }));

      const checkpointPromise = new Promise<GuardedResult<T>>((resolve) => {
        checkpointListener = () => resolve({ kind: 'checkpoint' });
        checkpointListeners.add(checkpointListener);
      });

      const timeoutPromise = new Promise<GuardedResult<T>>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
        timeoutHandle.unref?.();
      });

      try {
        const result = await Promise.race([operationPromise, checkpointPromise, timeoutPromise]);
        if (result.kind === 'checkpoint') {
          throw new SecurityCheckpointDetected(checkpointReason);
        }
        if (result.kind === 'timeout') {
          throw new Error(`${label} timed out after ${timeoutMs}ms`);
        }
        if (result.kind === 'error') {
          throw result.error;
        }
        return result.value;
      } finally {
        if (checkpointListener) {
          checkpointListeners.delete(checkpointListener);
        }
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    };

    const startWatchdog = () => {
      watchdogInterval = setInterval(async () => {
        try {
          if (this.isStopped || !this.page) return;
          const content = await this.getPageContent();
          const lower = String(content).toLowerCase();
          const antiBotIndicators = [
            'cf-challenge',
            'cloudflare',
            'recaptcha',
            'hcaptcha',
            'captcha',
            'verify you are human',
            'verify you are a human',
            'robot check',
            '429 too many requests',
            'access denied',
            'security checkpoint',
          ];

          for (const indicator of antiBotIndicators) {
            if (lower.includes(indicator)) {
              raiseCheckpoint(`Security checkpoint detected: "${indicator}"`);
              break;
            }
          }
        } catch {
          // Ignore polling errors while pages are navigating or closing.
        }
      }, WATCHDOG_INTERVAL_MS);
      watchdogInterval.unref?.();
    };

    try {
      await runGuarded('stagehand.init', INIT_TIMEOUT_MS, async () => {
        const isHeadless = this.session.mode === 'isolated';
        const { Stagehand } = await import('@browserbasehq/stagehand');
        this.stagehand = new Stagehand({
          env: process.env.BROWSERBASE_API_KEY ? 'BROWSERBASE' : 'LOCAL',
          apiKey: process.env.BROWSERBASE_API_KEY,
          projectId: process.env.BROWSERBASE_PROJECT_ID,
          verbose: 1,
          localBrowserLaunchOptions: {
            headless: isHeadless,
          },
        }) as unknown as StagehandInstance;
        await this.stagehand.init();
        this.page = this.resolveActivePage();
      });

      if (!this.page) {
        throw new Error('Stagehand did not expose a browser page instance.');
      }

      startWatchdog();

      for (const entry of this.session.actionLog) {
        if (checkpointDetected) {
          throw new SecurityCheckpointDetected(checkpointReason);
        }

        if (this.isStopped) {
          entry.status = 'stopped';
          entry.evidence = 'Session stopped by operator request.';
          continue;
        }

        const action = normalizeAction(entry);
        if (!BROWSER_ACTIONS.has(action)) {
          entry.status = 'completed';
          entry.evidence = `Skipped non-browser step (${entry.tool}${entry.action ? `.${entry.action}` : ''}); execute it with its dedicated tool.`;
          continue;
        }

        if (action.includes('/')) {
          entry.status = 'blocked';
          entry.evidence = `Composite placeholder "${action}" needs a concrete observed ref, selector, or instruction.`;
          this.isStopped = true;
          continue;
        }

        if (requiresStepConfirmation(entry, action)) {
          const confirmationService = ConfirmationService.getInstance();
          const result = await confirmationService.requestConfirmation({
            operation: 'browser_write',
            filename: action,
            content: buildConfirmationMessage(entry, action),
          });

          if (!result.confirmed) {
            this.isStopped = true;
            entry.status = 'stopped';
            entry.evidence = 'Consent denied by operator.';
            throw new Error('BrowserOperatorConsentDenied: Execution stopped by user.');
          }
        }

        entry.status = 'running';
        logger.info(`BrowserOperatorExecutor: Running action ${entry.sequence}: ${entry.title}`);

        try {
          const result = await this.executeBrowserAction(entry, action, cwd, runGuarded);
          entry.status = 'completed';
          entry.evidence = result.evidence;
        } catch (err) {
          if (err instanceof SecurityCheckpointDetected) {
            entry.status = 'blocked';
            entry.evidence = err.message;
            throw err;
          }

          const message = err instanceof Error ? err.message : String(err);
          entry.status = 'blocked';
          entry.evidence = `Failed: ${message}`;
          logger.error('BrowserOperatorExecutor: Action failed', err as Error);
          this.isStopped = true;
        }

        if (entry.evidence) {
          for (const condition of this.session.stopControl.stopConditions) {
            if (entry.evidence.toLowerCase().includes(condition.toLowerCase())) {
              logger.warn(`BrowserOperatorExecutor: Stop condition met: "${condition}"`);
              this.isStopped = true;
              entry.status = 'stopped';
              entry.evidence += `\n[Stopped: Stop condition "${condition}" matched]`;
              break;
            }
          }
        }
      }
    } finally {
      if (watchdogInterval) {
        clearInterval(watchdogInterval);
      }
      try {
        await this.stagehand?.close();
      } catch {
        // Ignore close failures.
      }
    }

    const proofFileName = `${this.session.sessionId}.browser-operator.json`;
    const success = !this.isStopped && this.session.actionLog.every((entry) => entry.status === 'completed');
    const stopped = this.isStopped;
    const generatedAt = new Date().toISOString();
    const harness = buildBrowserOperatorHarnessBundle({
      session: this.session,
      artifactRef: proofFileName,
      success,
      stopped,
      createdAt: Date.parse(generatedAt),
    });

    const proofArtifact = {
      sessionId: this.session.sessionId,
      generatedAt,
      goal: this.session.goal,
      mode: this.session.mode,
      engine: 'stagehand-browser-pilot',
      capabilities: [
        'navigation',
        'semantic-actions',
        'llm-element-identification',
        'deterministic-selectors',
        'keyboard-mouse',
        'forms',
        'screenshots',
        'dom-extraction',
        'assertions',
        'storage',
        'cookies',
        'tabs',
        'downloads',
        'uploads',
        'watchdog',
      ],
      consent: this.session.consent,
      actionLog: this.session.actionLog,
      success,
      stopped,
      harness,
    };

    const proofPath = path.join(cwd, '.codebuddy', 'runs', this.session.sessionId, 'artifacts', proofFileName);
    fs.mkdirSync(path.dirname(proofPath), { recursive: true });
    fs.writeFileSync(proofPath, JSON.stringify(proofArtifact, null, 2), 'utf-8');

    logger.info(`BrowserOperatorExecutor: Execution complete. Proof written to ${proofFileName}`);

    return {
      success: proofArtifact.success,
      stopped: proofArtifact.stopped,
      actionLog: this.session.actionLog,
    };
  }

  private async executeBrowserAction(
    entry: BrowserOperatorActionLogEntry,
    action: string,
    cwd: string,
    runGuarded: <T>(label: string, timeoutMs: number, operation: () => Promise<T>) => Promise<T>,
  ): Promise<BrowserActionResult> {
    const page = this.requirePage();
    const inputs = entry.inputs ?? {};
    const timeoutMs = getTimeout(inputs, timeoutForAction(action));

    switch (action) {
      case 'navigate': {
        const url = getString(inputs.url) || this.session.query;
        if (!url) throw new Error('navigate requires inputs.url or session.query');
        await runGuarded('page.goto', NAVIGATION_TIMEOUT_MS, () => page.goto(url, {
          waitUntil: getString(inputs.waitUntil) || 'domcontentloaded',
          timeout: getTimeout(inputs, NAVIGATION_TIMEOUT_MS),
          timeoutMs: getTimeout(inputs, NAVIGATION_TIMEOUT_MS),
        }));
        return { evidence: `Successfully navigated to ${url}` };
      }

      case 'go_back':
        await runGuarded('page.goBack', timeoutMs, () => page.goBack?.() ?? Promise.resolve());
        return { evidence: 'Navigated back' };

      case 'go_forward':
        await runGuarded('page.goForward', timeoutMs, () => page.goForward?.() ?? Promise.resolve());
        return { evidence: 'Navigated forward' };

      case 'reload':
        await runGuarded('page.reload', timeoutMs, () => page.reload?.({ timeout: timeoutMs }) ?? Promise.resolve());
        return { evidence: 'Page reloaded' };

      case 'observe': {
        const observed = await runGuarded('browser.observe', timeoutMs, () => this.observePage(inputs));
        return { evidence: `Observation snapshot\n${formatStructured(observed)}` };
      }

      case 'extract': {
        const extracted = await runGuarded('browser.extract', EXTRACT_TIMEOUT_MS, () => this.extractPage(inputs));
        return { evidence: `Extracted page state\n${formatStructured(extracted)}` };
      }

      case 'identify_element':
      case 'resolve_element': {
        const target = getElementIntent(entry, action);
        if (!target) throw new Error(`${action} requires target, instruction, text, label, or title`);
        const element = await runGuarded('browser.identify_element', EXTRACT_TIMEOUT_MS, () => this.identifyElement(target, inputs));
        return { evidence: `Identified element: ${element.selector}\n${formatStructured(element)}` };
      }

      case 'assert_text': {
        const expected = getString(inputs.expectedText) || getString(inputs.text) || getString(inputs.query);
        if (!expected) throw new Error('assert_text requires expectedText, text, or query');
        const text = await runGuarded('browser.assert_text', timeoutMs, () => this.getVisibleText());
        if (!text.toLowerCase().includes(expected.toLowerCase())) {
          throw new Error(`Expected text not found: ${expected}`);
        }
        return { evidence: `Assertion passed: page contains "${expected}"` };
      }

      case 'act':
        return {
          evidence: await runGuarded('page.act', timeoutMs, () => this.semanticAct(
            getString(inputs.instruction) || getString(inputs.text) || entry.title,
          )),
        };

      case 'click':
      case 'double_click':
      case 'right_click':
        return {
          evidence: await runGuarded(`browser.${action}`, timeoutMs, () => this.clickLike(action, entry)),
        };

      case 'type':
        return {
          evidence: await runGuarded('browser.type', timeoutMs, () => this.typeText(entry)),
        };

      case 'fill':
        return {
          evidence: await runGuarded('browser.fill', timeoutMs, () => this.fillFields(entry)),
        };

      case 'select':
        return {
          evidence: await runGuarded('browser.select', timeoutMs, () => this.selectOption(entry)),
        };

      case 'press': {
        const key = getString(inputs.key);
        if (!key) throw new Error('press requires inputs.key');
        await runGuarded('page.keyboard.press', timeoutMs, () => {
          if (page.keyboard?.press) return page.keyboard.press(key);
          if (page.keyPress) return page.keyPress(key);
          return this.semanticAct(`press ${key}`);
        });
        return { evidence: `Pressed ${key}` };
      }

      case 'hover':
        return {
          evidence: await runGuarded('browser.hover', timeoutMs, () => this.hover(entry)),
        };

      case 'scroll':
        return {
          evidence: await runGuarded('browser.scroll', timeoutMs, () => this.scroll(inputs)),
        };

      case 'evaluate': {
        const expression = getString(inputs.expression) || getString(inputs.script);
        if (!expression) throw new Error('evaluate requires inputs.expression');
        const result = await runGuarded('page.evaluate', timeoutMs, () => page.evaluate(expression, inputs.args));
        return { evidence: `Evaluation result: ${formatStructured(result)}` };
      }

      case 'get_content': {
        const content = await runGuarded('page.content', timeoutMs, () => this.getPageContent());
        return { evidence: truncate(String(content), 8_000) };
      }

      case 'get_text': {
        const text = await runGuarded('page.text', timeoutMs, () => this.getVisibleText());
        return { evidence: truncate(text, 8_000) };
      }

      case 'get_url':
        return { evidence: String(page.url?.() ?? '') };

      case 'get_title': {
        const title = await runGuarded('page.title', timeoutMs, () => page.title?.() ?? Promise.resolve(''));
        return { evidence: String(title) };
      }

      case 'screenshot': {
        const artifactPath = await runGuarded('page.screenshot', timeoutMs, () => this.takeScreenshot(entry, cwd));
        return { evidence: `Screenshot saved: ${artifactPath}`, artifactPath };
      }

      case 'wait':
        await runGuarded('page.waitForTimeout', timeoutMs, () => page.waitForTimeout?.(getNumber(inputs.ms) ?? getNumber(inputs.timeout) ?? 1_000) ?? Promise.resolve());
        return { evidence: 'Wait completed' };

      case 'wait_for_selector': {
        const selector = getString(inputs.selector);
        if (!selector) throw new Error('wait_for_selector requires inputs.selector');
        await runGuarded('page.waitForSelector', timeoutMs, () => page.waitForSelector(selector, { timeout: timeoutMs }));
        return { evidence: `Selector appeared: ${selector}` };
      }

      case 'wait_for_navigation':
        await runGuarded('page.waitForURL', timeoutMs, () => {
          if (page.waitForURL) return page.waitForURL('**', { timeout: timeoutMs });
          if (page.waitForLoadState) return page.waitForLoadState('domcontentloaded', timeoutMs);
          return Promise.resolve();
        });
        return { evidence: 'Navigation completed' };

      case 'get_cookies': {
        const cookies = await runGuarded('context.cookies', timeoutMs, () => this.context().cookies?.() ?? Promise.resolve([]));
        return { evidence: `Cookies: ${formatStructured(cookies)}` };
      }

      case 'set_cookie':
        await runGuarded('context.addCookies', timeoutMs, () => this.context().addCookies?.([buildCookie(inputs)]) ?? Promise.resolve());
        return { evidence: `Cookie set: ${getString(inputs.cookieName) || getString(inputs.name)}` };

      case 'clear_cookies':
        await runGuarded('context.clearCookies', timeoutMs, () => this.context().clearCookies?.() ?? Promise.resolve());
        return { evidence: 'Cookies cleared' };

      case 'get_local_storage':
        return { evidence: `localStorage: ${formatStructured(await runGuarded('localStorage', timeoutMs, () => this.getStorage('localStorage')))}` };

      case 'set_local_storage':
        await runGuarded('set localStorage', timeoutMs, () => this.setStorage('localStorage', getRecord(inputs.storageData)));
        return { evidence: `Set ${Object.keys(getRecord(inputs.storageData)).length} localStorage entries` };

      case 'get_session_storage':
        return { evidence: `sessionStorage: ${formatStructured(await runGuarded('sessionStorage', timeoutMs, () => this.getStorage('sessionStorage')))}` };

      case 'set_session_storage':
        await runGuarded('set sessionStorage', timeoutMs, () => this.setStorage('sessionStorage', getRecord(inputs.storageData)));
        return { evidence: `Set ${Object.keys(getRecord(inputs.storageData)).length} sessionStorage entries` };

      case 'upload_files':
        return {
          evidence: await runGuarded('upload files', timeoutMs, () => this.uploadFiles(entry)),
        };

      case 'download':
        return {
          evidence: await runGuarded('download', timeoutMs, () => this.download(entry, cwd)),
        };

      case 'tabs':
        return { evidence: `Tabs: ${formatStructured(await this.listTabs())}` };

      case 'new_tab': {
        const tab = await runGuarded('new tab', timeoutMs, () => this.newTab(getString(inputs.url)));
        return { evidence: `New tab opened: ${formatStructured(tab)}` };
      }

      case 'focus_tab':
        await runGuarded('focus tab', timeoutMs, () => this.focusTab(inputs));
        return { evidence: 'Focused tab' };

      case 'close_tab':
        await runGuarded('close tab', timeoutMs, () => this.closeTab(inputs));
        return { evidence: 'Closed tab' };

      default:
        throw new Error(`Unsupported browser action: ${action}`);
    }
  }

  private requirePage(): StagehandPage {
    this.page ??= this.resolveActivePage();
    if (!this.page) {
      throw new Error('Browser page is not initialized.');
    }
    return this.page;
  }

  private context(): StagehandContext {
    if (this.stagehand?.context) {
      return this.stagehand.context;
    }
    const page = this.requirePage();
    const context = page.context?.();
    if (!context) {
      throw new Error('Browser context is not available.');
    }
    return context;
  }

  private resolveActivePage(): StagehandPage | null {
    if (this.stagehand?.page) {
      return this.stagehand.page;
    }

    const context = this.stagehand?.context;
    if (!context) {
      return null;
    }

    return context.activePage?.() ?? context.pages?.()[0] ?? null;
  }

  private async semanticAct(instruction: string): Promise<string> {
    const page = this.requirePage();
    if (page.act) {
      await page.act({ action: instruction });
      return `Successfully performed semantic action: ${instruction}`;
    }

    if (!this.stagehand?.act) {
      throw new Error('Stagehand semantic action API is not available.');
    }

    await this.stagehand.act(instruction);
    return `Successfully performed semantic action: ${instruction}`;
  }

  private async clickLike(action: string, entry: BrowserOperatorActionLogEntry): Promise<string> {
    const page = this.requirePage();
    const inputs = entry.inputs ?? {};
    const selector = getString(inputs.selector);
    const text = getString(inputs.text);
    const target = getElementIntent(entry, action);
    const ref = inputs.ref;
    const button = action === 'right_click' ? 'right' : getString(inputs.button) || 'left';
    const clickCount = action === 'double_click' ? 2 : getNumber(inputs.clickCount) ?? 1;
    let resolved: ResolvedBrowserElement | null = null;
    let effectiveSelector = selector;

    if (!effectiveSelector && target && ref === undefined) {
      resolved = await this.tryIdentifyElement(target, inputs);
      effectiveSelector = resolved?.selector ?? '';
    }

    if (effectiveSelector) {
      const locator = page.locator?.(effectiveSelector);
      if (locator?.click) {
        await locator.click({ button, clickCount });
      } else if (page.click) {
        await page.click(effectiveSelector, { button, clickCount });
      } else {
        throw new Error('No selector click API available on page.');
      }
      return `Clicked selector ${effectiveSelector}${resolved ? ` (${resolved.source}: ${resolved.description})` : ''}`;
    }

    const instruction = text
      ? `click on "${text}"`
      : `click ${ref !== undefined ? `element with reference ${ref}` : entry.title}`;
    return this.semanticAct(instruction);
  }

  private async typeText(entry: BrowserOperatorActionLogEntry): Promise<string> {
    const page = this.requirePage();
    const inputs = entry.inputs ?? {};
    const selector = getString(inputs.selector);
    const target = getElementIntent(entry, 'type');
    const text = getString(inputs.text) || getString(inputs.value);
    if (!text) throw new Error('type requires inputs.text or inputs.value');
    let resolved: ResolvedBrowserElement | null = null;
    let effectiveSelector = selector;

    if (!effectiveSelector && target && inputs.ref === undefined) {
      resolved = await this.tryIdentifyElement(target, inputs);
      effectiveSelector = resolved?.selector ?? '';
    }

    if (effectiveSelector) {
      const locator = page.locator?.(effectiveSelector);
      if (locator?.fill && inputs.clear !== false) {
        await locator.fill(text);
      } else if (locator?.type) {
        await locator.type(text);
      } else if (page.fill && inputs.clear !== false) {
        await page.fill(effectiveSelector, text);
      } else if (page.type) {
        await page.type(effectiveSelector, text);
      } else {
        throw new Error('No selector typing API available on page.');
      }
      return `Typed ${text.length} chars into ${effectiveSelector}${resolved ? ` (${resolved.source}: ${resolved.description})` : ''}`;
    }

    return this.semanticAct(`type "${text}" into ${getString(inputs.ref) || entry.title}`);
  }

  private async fillFields(entry: BrowserOperatorActionLogEntry): Promise<string> {
    const inputs = entry.inputs ?? {};
    const fields = getRecord(inputs.fields);
    const selector = getString(inputs.selector);
    const value = getString(inputs.value) || getString(inputs.text);

    if (selector && value) {
      await this.typeText({ ...entry, inputs: { ...inputs, selector, text: value } });
      return `Filled ${selector}`;
    }

    if (Object.keys(fields).length === 0) {
      throw new Error('fill requires inputs.fields, or selector + value');
    }

    for (const [target, fieldValue] of Object.entries(fields)) {
      await this.typeText({
        ...entry,
        inputs: isNumeric(target)
          ? { ...inputs, ref: Number(target), text: String(fieldValue) }
          : { ...inputs, selector: target, text: String(fieldValue) },
      });
    }

    if (inputs.submit === true) {
      await this.requirePage().keyboard?.press?.('Enter');
    }

    return `Filled ${Object.keys(fields).length} field(s)`;
  }

  private async selectOption(entry: BrowserOperatorActionLogEntry): Promise<string> {
    const page = this.requirePage();
    const inputs = entry.inputs ?? {};
    const selector = getString(inputs.selector);
    const value = getString(inputs.value) || getString(inputs.label) || getString(inputs.index);
    if (!value) throw new Error('select requires value, label, or index');
    let resolved: ResolvedBrowserElement | null = null;
    let effectiveSelector = selector;

    if (!effectiveSelector) {
      const target = getElementIntent(entry, 'select');
      if (target) {
        resolved = await this.tryIdentifyElement(target, inputs);
        effectiveSelector = resolved?.selector ?? '';
      }
    }

    if (effectiveSelector) {
      if (page.selectOption) {
        await page.selectOption(effectiveSelector, value);
      } else {
        const locator = page.locator?.(effectiveSelector);
        if (!locator?.selectOption) throw new Error('No select API available on page.');
        await locator.selectOption(value);
      }
      return `Selected ${value} in ${effectiveSelector}${resolved ? ` (${resolved.source}: ${resolved.description})` : ''}`;
    }

    return this.semanticAct(`select "${value}" in ${entry.title}`);
  }

  private async hover(entry: BrowserOperatorActionLogEntry): Promise<string> {
    const page = this.requirePage();
    const inputs = entry.inputs ?? {};
    const selector = getString(inputs.selector);
    let resolved: ResolvedBrowserElement | null = null;
    let effectiveSelector = selector;
    if (!effectiveSelector) {
      const target = getElementIntent(entry, 'hover');
      if (target) {
        resolved = await this.tryIdentifyElement(target, inputs);
        effectiveSelector = resolved?.selector ?? '';
      }
    }

    if (effectiveSelector) {
      const locator = page.locator?.(effectiveSelector);
      if (locator?.hover) {
        await locator.hover();
      } else if (page.hover) {
        await page.hover(effectiveSelector);
      } else {
        throw new Error('No hover API available on page.');
      }
      return `Hovered ${effectiveSelector}${resolved ? ` (${resolved.source}: ${resolved.description})` : ''}`;
    }
    return this.semanticAct(`hover ${getString(inputs.text) || getString(inputs.ref) || entry.title}`);
  }

  private async tryIdentifyElement(target: string, inputs: Record<string, any> = {}): Promise<ResolvedBrowserElement | null> {
    try {
      return await this.identifyElement(target, inputs);
    } catch (error) {
      logger.warn(`BrowserOperatorExecutor: LLM element identification fell back for "${target}": ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private async identifyElement(target: string, inputs: Record<string, any> = {}): Promise<ResolvedBrowserElement> {
    const instruction = [
      `Identify the single best visible page element for: ${target}`,
      'Return an action whose selector can be used directly by automation.',
      getString(inputs.scope) ? `Scope: ${getString(inputs.scope)}` : '',
      getString(inputs.role) ? `Preferred role: ${getString(inputs.role)}` : '',
    ].filter(Boolean).join('\n');

    const observed = await this.observeActions(instruction, inputs);
    const ranked = observed
      .map((candidate) => normalizeObservedAction(candidate))
      .filter((candidate): candidate is ResolvedBrowserElement => Boolean(candidate?.selector))
      .sort((a, b) => scoreObservedElement(b, target) - scoreObservedElement(a, target));

    if (ranked[0]) {
      return ranked[0];
    }

    const fallback = await this.findElementByDomHeuristic(target);
    if (fallback) {
      return fallback;
    }

    throw new Error(`Could not identify a page element for: ${target}`);
  }

  private async observeActions(instruction: string, inputs: Record<string, any>): Promise<unknown[]> {
    const page = this.requirePage();
    const selector = getString(inputs.observeSelector) || getString(inputs.scopeSelector);
    const options = {
      instruction,
      ...(selector ? { selector } : {}),
      timeout: getTimeout(inputs, EXTRACT_TIMEOUT_MS),
    };

    if (page.observe) {
      const observed = await page.observe(options);
      return Array.isArray(observed) ? observed : [];
    }

    if (this.stagehand?.observe) {
      const observed = await this.stagehand.observe(instruction, { ...options, page });
      return Array.isArray(observed) ? observed : [];
    }

    return [];
  }

  private async findElementByDomHeuristic(target: string): Promise<ResolvedBrowserElement | null> {
    const page = this.requirePage();
    if (!page.evaluate) {
      return null;
    }

    const match = await page.evaluate((needle: string) => {
      const normalizedNeedle = needle.toLowerCase();
      const take = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim();
      const cssEscape = (value: string) => {
        const css = (globalThis as typeof globalThis & { CSS?: { escape?: (input: string) => string } }).CSS;
        if (css?.escape) return css.escape(value);
        return value.replace(/["\\#.:,[\]>+~*'=|^$()\s]/g, '\\$&');
      };
      const selectorFor = (el: Element): string => {
        const id = el.getAttribute('id');
        if (id) return `#${cssEscape(id)}`;
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-test');
        if (testId) return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
        const aria = el.getAttribute('aria-label');
        if (aria) return `${el.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, '\\"')}"]`;
        const name = el.getAttribute('name');
        if (name) return `${el.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;
        const role = el.getAttribute('role');
        if (role) return `${el.tagName.toLowerCase()}[role="${role.replace(/"/g, '\\"')}"]`;
        const parent = el.parentElement;
        if (!parent) return el.tagName.toLowerCase();
        const siblings = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
        const index = siblings.indexOf(el) + 1;
        return `${selectorFor(parent)} > ${el.tagName.toLowerCase()}:nth-of-type(${Math.max(index, 1)})`;
      };

      const candidates = Array.from(document.querySelectorAll('button,[role="button"],a[href],input,textarea,select,[contenteditable="true"]'));
      let best: { selector: string; description: string; score: number } | null = null;
      for (const el of candidates) {
        const htmlEl = el as HTMLElement;
        const description = take([
          el.getAttribute('aria-label'),
          el.getAttribute('placeholder'),
          el.getAttribute('name'),
          el.getAttribute('title'),
          htmlEl.innerText,
          el.textContent,
          el.getAttribute('id'),
        ].filter(Boolean).join(' '));
        const haystack = description.toLowerCase();
        const tokens = normalizedNeedle.split(/\W+/).filter((token) => token.length > 2);
        const tokenHits = tokens.filter((token) => haystack.includes(token)).length;
        const score = (haystack.includes(normalizedNeedle) ? 10 : 0) + tokenHits + (htmlEl.offsetParent ? 1 : 0);
        if (score > 0 && (!best || score > best.score)) {
          best = { selector: selectorFor(el), description, score };
        }
      }
      return best;
    }, target);

    if (!match || typeof match !== 'object') {
      return null;
    }

    const selector = getString((match as Record<string, unknown>).selector);
    if (!selector) {
      return null;
    }

    return {
      selector,
      description: getString((match as Record<string, unknown>).description) || target,
      source: 'dom-heuristic',
    };
  }

  private async scroll(inputs: Record<string, any>): Promise<string> {
    const page = this.requirePage();
    const direction = getString(inputs.direction) || 'down';
    const amount = getNumber(inputs.amount) ?? 600;
    const sign = direction === 'up' || direction === 'left' ? -1 : 1;
    const x = direction === 'left' || direction === 'right' ? sign * amount : 0;
    const y = direction === 'up' || direction === 'down' ? sign * amount : 0;

    if (page.mouse?.wheel) {
      await page.mouse.wheel(x, y);
    } else if (page.evaluate) {
      await page.evaluate(({ left, top }: { left: number; top: number }) => window.scrollBy(left, top), { left: x, top: y });
    } else {
      throw new Error('No scroll API available on page.');
    }

    return `Scrolled ${direction} ${amount}px`;
  }

  private async observePage(inputs: Record<string, any>): Promise<unknown> {
    const page = this.requirePage();
    const instruction = getString(inputs.instruction) || getString(inputs.query) || 'Observe visible page state, blockers, forms, and actions.';
    if (page.observe) {
      return await page.observe({ instruction });
    }
    if (this.stagehand?.observe) {
      return await this.stagehand.observe(instruction);
    }
    return await this.extractDomState();
  }

  private async extractPage(inputs: Record<string, any>): Promise<unknown> {
    const page = this.requirePage();
    const instruction = getString(inputs.instruction) || getString(inputs.query);
    if (instruction && page.extract) {
      const { z } = await import('zod');
      return await page.extract({
        instruction,
        schema: z.object({ result: z.string() }),
      });
    }
    if (instruction && this.stagehand?.extract) {
      const { z } = await import('zod');
      return await this.stagehand.extract(instruction, z.object({ result: z.string() }));
    }
    return await this.extractDomState();
  }

  private async extractDomState(): Promise<unknown> {
    const page = this.requirePage();
    if (!page.evaluate) {
      const content = page.content ? await page.content() : '';
      return { text: String(content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() };
    }

    return await page.evaluate(() => {
      const take = (value: unknown, max = 160) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
      const text = (document.body?.innerText || '').replace(/\s+\n/g, '\n').trim();
      return {
        url: location.href,
        title: document.title,
        headings: Array.from(document.querySelectorAll('h1,h2,h3')).map((el) => take(el.textContent)).filter(Boolean).slice(0, 20),
        actions: Array.from(document.querySelectorAll('button,[role="button"],a[href],input,textarea,select'))
          .map((el) => take(el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || el.id))
          .filter(Boolean)
          .slice(0, 40),
        fields: Array.from(document.querySelectorAll('input,textarea,select'))
          .map((el) => take(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id))
          .filter(Boolean)
          .slice(0, 30),
        links: Array.from(document.querySelectorAll('a[href]'))
          .map((el) => ({ text: take(el.textContent || el.getAttribute('aria-label')), href: (el as HTMLAnchorElement).href }))
          .filter((link) => link.text || link.href)
          .slice(0, 40),
        text: text.slice(0, 12_000),
        textLength: text.length,
      };
    });
  }

  private async getVisibleText(): Promise<string> {
    const page = this.requirePage();
    if (page.evaluate) {
      return String(await page.evaluate(() => document.body?.innerText || ''));
    }
    const content = await this.getPageContent();
    return String(content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private async getPageContent(): Promise<string> {
    const page = this.requirePage();
    if (page.content) {
      return String(await page.content());
    }
    if (page.evaluate) {
      return String(await page.evaluate(() => document.documentElement?.outerHTML || document.body?.innerHTML || ''));
    }
    return '';
  }

  private async takeScreenshot(entry: BrowserOperatorActionLogEntry, cwd: string): Promise<string> {
    const page = this.requirePage();
    if (!page.screenshot) {
      throw new Error('Screenshot API is not available.');
    }
    const inputs = entry.inputs ?? {};
    const artifactPath = getString(inputs.outputPath) || path.join(
      cwd,
      '.codebuddy',
      'runs',
      this.session.sessionId,
      'artifacts',
      `evidence_${entry.id}.png`,
    );
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    const buffer = await page.screenshot({
      fullPage: inputs.fullPage === true,
      path: page.screenshot.length === 0 ? undefined : artifactPath,
    });
    if (Buffer.isBuffer(buffer)) {
      fs.writeFileSync(artifactPath, buffer);
    }
    return artifactPath;
  }

  private async getStorage(kind: 'localStorage' | 'sessionStorage'): Promise<Record<string, string>> {
    const page = this.requirePage();
    if (!page.evaluate) {
      return {};
    }
    return await page.evaluate((storageKind: 'localStorage' | 'sessionStorage') => {
      const storage = window[storageKind];
      const data: Record<string, string> = {};
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key) data[key] = storage.getItem(key) || '';
      }
      return data;
    }, kind);
  }

  private async setStorage(kind: 'localStorage' | 'sessionStorage', data: Record<string, unknown>): Promise<void> {
    const page = this.requirePage();
    if (!page.evaluate) {
      throw new Error('Storage API requires page.evaluate.');
    }
    await page.evaluate(({ storageKind, entries }: { storageKind: 'localStorage' | 'sessionStorage'; entries: Record<string, string> }) => {
      const storage = window[storageKind];
      for (const [key, value] of Object.entries(entries)) {
        storage.setItem(key, value);
      }
    }, {
      storageKind: kind,
      entries: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)])),
    });
  }

  private async uploadFiles(entry: BrowserOperatorActionLogEntry): Promise<string> {
    const page = this.requirePage();
    const inputs = entry.inputs ?? {};
    const files = Array.isArray(inputs.files) ? inputs.files.map(String) : [];
    if (files.length === 0) throw new Error('upload_files requires inputs.files');
    const selector = getString(inputs.selector) || 'input[type="file"]';
    const locator = page.locator?.(selector);
    if (!locator?.setInputFiles) {
      throw new Error('File upload requires locator.setInputFiles.');
    }
    await locator.setInputFiles(files);
    return `Uploaded ${files.length} file(s) via ${selector}`;
  }

  private async download(entry: BrowserOperatorActionLogEntry, cwd: string): Promise<string> {
    const page = this.requirePage();
    if (!page.waitForEvent) {
      throw new Error('Download requires page.waitForEvent.');
    }
    const inputs = entry.inputs ?? {};
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: getTimeout(inputs, ACTION_TIMEOUT_MS) }),
      this.clickLike('click', entry),
    ]);
    const suggestedFilename = download.suggestedFilename?.() ?? `download-${Date.now()}`;
    const outputPath = getString(inputs.downloadPath) || path.join(cwd, '.codebuddy', 'runs', this.session.sessionId, 'artifacts', suggestedFilename);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    if (download.saveAs) {
      await download.saveAs(outputPath);
    }
    return `Downloaded ${suggestedFilename} to ${outputPath}`;
  }

  private async listTabs(): Promise<Array<{ index: number; url: string; title: string; active: boolean }>> {
    const page = this.requirePage();
    const pages = this.context().pages?.() ?? [page];
    return await Promise.all(pages.map(async (tab: StagehandPage, index: number) => ({
      index,
      url: String(tab.url?.() ?? ''),
      title: String(await (tab.title?.() ?? Promise.resolve(''))),
      active: tab === page,
    })));
  }

  private async newTab(url?: string): Promise<{ index: number; url: string; title: string }> {
    const context = this.context();
    if (!context.newPage) {
      throw new Error('new_tab requires context.newPage.');
    }
    const newPage = await context.newPage(url);
    this.page = newPage;
    if (url && newPage.url?.() !== url) {
      await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS, timeoutMs: NAVIGATION_TIMEOUT_MS });
    }
    const tabs = context.pages?.() ?? [newPage];
    return {
      index: Math.max(0, tabs.indexOf(newPage)),
      url: String(newPage.url?.() ?? ''),
      title: String(await (newPage.title?.() ?? Promise.resolve(''))),
    };
  }

  private async focusTab(inputs: Record<string, any>): Promise<void> {
    const context = this.context();
    const pages = context.pages?.() ?? [];
    const index = getNumber(inputs.index) ?? getNumber(inputs.tabId) ?? 0;
    const target = pages[index];
    if (!target) throw new Error(`Tab not found: ${index}`);
    if (context.setActivePage) {
      context.setActivePage(target);
    } else {
      await target.bringToFront?.();
    }
    this.page = target;
  }

  private async closeTab(inputs: Record<string, any>): Promise<void> {
    const context = this.context();
    const pages = context.pages?.() ?? [];
    const index = getNumber(inputs.index) ?? getNumber(inputs.tabId) ?? pages.indexOf(this.requirePage());
    const target = pages[index];
    if (!target) throw new Error(`Tab not found: ${index}`);
    await target.close?.();
    const remaining = context.pages?.() ?? [];
    this.page = remaining[0] ?? this.page;
  }
}

function normalizeAction(entry: BrowserOperatorActionLogEntry): string {
  const rawAction = String(entry.action || entry.tool || '').trim().toLowerCase();
  return rawAction
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
}

function requiresStepConfirmation(entry: BrowserOperatorActionLogEntry, action: string): boolean {
  return MUTATING_ACTIONS.has(action) || entry.requiresConsent === true && action !== 'navigate';
}

function buildConfirmationMessage(entry: BrowserOperatorActionLogEntry, action: string): string {
  const inputs = entry.inputs ?? {};
  const target = inputs.selector !== undefined
    ? `selector ${inputs.selector}`
    : inputs.ref !== undefined
      ? `element ${inputs.ref}`
      : getString(inputs.text) || getString(inputs.instruction) || entry.title || 'active element';
  const text = inputs.text !== undefined ? ` with text: "${inputs.text}"` : '';
  return `Execute browser action: ${action} on ${target}${text}`;
}

function getElementIntent(entry: BrowserOperatorActionLogEntry, action: string): string {
  const inputs = entry.inputs ?? {};
  return getString(inputs.target)
    || getString(inputs.llmTarget)
    || getString(inputs.element)
    || getString(inputs.description)
    || getString(inputs.instruction)
    || getString(inputs.label)
    || (action === 'click' ? getString(inputs.text) : '')
    || (action === 'identify_element' || action === 'resolve_element' ? entry.title : '');
}

function normalizeObservedAction(candidate: unknown): ResolvedBrowserElement | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const selector = getString(record.selector);
  if (!selector) {
    return null;
  }

  return {
    selector,
    description: getString(record.description) || selector,
    method: getString(record.method) || undefined,
    arguments: Array.isArray(record.arguments) ? record.arguments.map(String) : undefined,
    source: 'stagehand-observe',
  };
}

function scoreObservedElement(candidate: ResolvedBrowserElement, target: string): number {
  const text = `${candidate.description} ${candidate.selector} ${candidate.method || ''}`.toLowerCase();
  const normalizedTarget = target.toLowerCase();
  const tokens = normalizedTarget.split(/\W+/).filter((token) => token.length > 2);
  const tokenHits = tokens.filter((token) => text.includes(token)).length;
  return (text.includes(normalizedTarget) ? 20 : 0)
    + tokenHits * 3
    + (candidate.method === 'click' ? 1 : 0)
    + (candidate.selector.startsWith('#') ? 1 : 0);
}

function timeoutForAction(action: string): number {
  if (action === 'navigate') return NAVIGATION_TIMEOUT_MS;
  if (action === 'extract' || action === 'observe') return EXTRACT_TIMEOUT_MS;
  return ACTION_TIMEOUT_MS;
}

function getTimeout(inputs: Record<string, any>, fallback: number): number {
  const timeout = getNumber(inputs.timeout);
  return timeout && timeout > 0 ? timeout : fallback;
}

function getString(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isNumeric(value: string): boolean {
  return /^\d+$/.test(value);
}

function buildCookie(inputs: Record<string, any>): Record<string, unknown> {
  const name = getString(inputs.cookieName) || getString(inputs.name);
  const value = getString(inputs.cookieValue) || getString(inputs.value);
  if (!name || !value) {
    throw new Error('set_cookie requires cookieName/name and cookieValue/value');
  }
  return {
    name,
    value,
    ...(getString(inputs.cookieDomain) ? { domain: getString(inputs.cookieDomain) } : {}),
    ...(getString(inputs.url) ? { url: getString(inputs.url) } : {}),
    path: getString(inputs.path) || '/',
  };
}

function formatStructured(value: unknown): string {
  if (typeof value === 'string') {
    return truncate(value, 8_000);
  }
  try {
    return truncate(JSON.stringify(value, null, 2), 8_000);
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n... (truncated)` : value;
}
