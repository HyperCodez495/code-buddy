/**
 * Browser backend readiness for the native Hermes-inspired profile.
 *
 * These checks stay non-destructive: status only inspects local packages,
 * optional environment configuration, and CLI presence. The explicit smoke
 * runner is the place that launches a real browser.
 */

import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import { mkdir, mkdtemp, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { isAbsolute, join, resolve } from 'path';
import type { Browser, BrowserContext } from 'playwright';

export type HermesBrowserBackendStatus = 'available' | 'configured' | 'missing' | 'unsupported';
export type HermesBrowserSmokeStatus = 'passed' | 'failed' | 'blocked' | 'unsupported' | 'not-runnable';

export interface HermesBrowserBackend {
  id: string;
  label: string;
  officialSurface: string;
  status: HermesBrowserBackendStatus;
  installed: boolean;
  configured: boolean;
  runnable: boolean;
  command: string | null;
  version: string | null;
  credentialSources: string[];
  smokeCommand: string | null;
  notes: string[];
  remediation: string[];
}

export interface HermesBrowserBackendsReadiness {
  ok: boolean;
  generatedAt: string;
  platform: NodeJS.Platform;
  localRunnableCount: number;
  managedConfiguredCount: number;
  routePlan: HermesBrowserBackendRoutePlan;
  backends: HermesBrowserBackend[];
  issues: string[];
  recommendations: string[];
}

export interface HermesBrowserBackendRoutePlan {
  autoEligibleBackendIds?: string[];
  fallbackBackendIds: string[];
  gatedBackendIds?: string[];
  gatedBackends?: HermesBrowserBackendRouteGate[];
  mode: 'hybrid';
  primaryBackendId: string | null;
  reason: string;
  smokeCommand: string | null;
}

export interface HermesBrowserBackendRouteGate {
  backendId: string;
  label: string;
  reason: string;
  smokeCommand: string | null;
}

export interface HermesBrowserBackendSmokeResult {
  artifacts?: HermesBrowserSmokeArtifact[];
  backendId: string;
  command: string | null;
  durationMs: number;
  finishedAt: string;
  label: string | null;
  ok: boolean;
  output: string;
  route?: HermesBrowserSmokeRoute;
  startedAt: string;
  status: HermesBrowserSmokeStatus;
  stdout: string;
  stderr: string;
  session?: {
    debugUrl?: string;
    id?: string;
    url?: string;
  };
}

/** One backend attempt made while resolving an `auto` hybrid-routed smoke. */
export interface HermesBrowserSmokeRouteAttempt {
  backendId: string;
  ok: boolean;
  status: HermesBrowserSmokeStatus;
}

/**
 * Records how an `auto` smoke was hybrid-routed: which backend ultimately served
 * the request, whether a fallback was needed, and every candidate attempted in
 * order. Only attached to results that were requested as `auto`.
 */
export interface HermesBrowserSmokeRoute {
  attempts: HermesBrowserSmokeRouteAttempt[];
  requested: 'auto';
  servedBy: string;
  usedFallback: boolean;
}

export interface HermesBrowserSmokeArtifact {
  exists: boolean;
  kind: 'playwright-trace';
  label: string;
  path: string;
  sizeBytes: number;
}

export interface HermesBrowserBackendsOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export interface HermesBrowserBackendSmokeOptions extends HermesBrowserBackendsOptions {
  artifactsDir?: string;
  backendId: string;
  cdpUrl?: string;
}

const require = createRequire(import.meta.url);

function presentEnvKeys(env: NodeJS.ProcessEnv, keys: readonly string[]): string[] {
  return keys.filter((key) => Boolean(env[key]?.trim()));
}

function firstLine(value: string): string | null {
  const line = value.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  return line ?? null;
}

function commandDisplayName(command: string | null): string | null {
  const trimmed = command?.trim();
  if (!trimmed) return null;
  const unquoted = trimmed.replace(/^["']|["']$/g, '');
  const segments = unquoted.split(/[\\/]/).filter(Boolean);
  if (isAbsolute(unquoted) || segments.length > 1) {
    return segments[segments.length - 1] ?? unquoted;
  }
  return unquoted;
}

function packageVersion(packageName: string): string | null {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const packageJson = require(packageJsonPath) as { version?: string };
    return packageJson.version ?? null;
  } catch {
    return null;
  }
}

function runProbe(command: string, args: string[], env: NodeJS.ProcessEnv): { ok: boolean; output: string } {
  try {
    const result = spawnSync(command, args, {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
      windowsHide: true,
    });
    return {
      ok: !result.error && result.status === 0,
      output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim(),
    };
  } catch {
    return { ok: false, output: '' };
  }
}

function localPlaywrightBackend(): HermesBrowserBackend {
  const version = packageVersion('playwright');
  const installed = Boolean(version);
  return {
    id: 'local-playwright',
    label: 'Local Playwright',
    officialSurface: 'local CDP/Playwright browser backend',
    status: installed ? 'available' : 'missing',
    installed,
    configured: installed,
    runnable: installed,
    command: commandDisplayName(process.execPath),
    version,
    credentialSources: [],
    smokeCommand: installed ? 'buddy hermes browser-smoke local-playwright --json' : null,
    notes: [
      'Status means the Playwright package is installed; the smoke runner launches Chromium and proves browser binaries work.',
    ],
    remediation: installed ? [] : ['Install Playwright and browser binaries before selecting local browser automation.'],
  };
}

function cdpBackend(env: NodeJS.ProcessEnv): HermesBrowserBackend {
  const playwrightVersion = packageVersion('playwright');
  const credentialSources = presentEnvKeys(env, [
    'CODEBUDDY_BROWSER_CDP_URL',
    'BROWSER_CDP_URL',
    'CHROME_REMOTE_DEBUGGING_URL',
  ]);
  const configured = credentialSources.length > 0;
  return {
    id: 'remote-cdp',
    label: 'Remote Chrome DevTools Protocol',
    officialSurface: 'local/remote CDP browser connection',
    status: configured ? 'configured' : playwrightVersion ? 'available' : 'missing',
    installed: Boolean(playwrightVersion),
    configured,
    runnable: Boolean(playwrightVersion && configured),
    command: null,
    version: playwrightVersion,
    credentialSources,
    smokeCommand: configured ? 'buddy hermes browser-smoke remote-cdp --json' : null,
    notes: ['Uses an already running browser endpoint; status never prints the endpoint value.'],
    remediation: configured
      ? []
      : [
        'Set CODEBUDDY_BROWSER_CDP_URL to attach to an existing browser session.',
        'Or run buddy hermes browser-smoke remote-cdp --cdp-url <ws-endpoint> --json for a one-shot proof.',
      ],
  };
}

function browserbaseBackend(env: NodeJS.ProcessEnv): HermesBrowserBackend {
  const stagehandVersion = packageVersion('@browserbasehq/stagehand');
  const credentialSources = presentEnvKeys(env, ['BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID']);
  const configured = credentialSources.includes('BROWSERBASE_API_KEY') &&
    credentialSources.includes('BROWSERBASE_PROJECT_ID');
  const runnable = Boolean(stagehandVersion && configured);
  return {
    id: 'browserbase',
    label: 'Browserbase / Stagehand',
    officialSurface: 'managed browser backend',
    status: configured ? 'configured' : stagehandVersion ? 'available' : 'missing',
    installed: Boolean(stagehandVersion),
    configured,
    runnable,
    command: null,
    version: stagehandVersion,
    credentialSources,
    smokeCommand: runnable ? 'buddy hermes browser-smoke browserbase --json' : null,
    notes: [
      'Stagehand is installed locally; managed Browserbase execution uses a real opt-in smoke runner when project credentials are present.',
    ],
    remediation: runnable
      ? []
      : configured
        ? ['Install @browserbasehq/stagehand before selecting Browserbase smoke runs.']
        : ['Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID for managed browser sessions.'],
  };
}

function browserUseBackend(env: NodeJS.ProcessEnv): HermesBrowserBackend {
  const credentialSources = presentEnvKeys(env, ['BROWSER_USE_API_KEY', 'CODEBUDDY_NOUS_TOOL_GATEWAY_URL']);
  const configured = credentialSources.length > 0;
  return {
    id: 'browser-use',
    label: 'Browser Use gateway',
    officialSurface: 'Browser Use managed browser mode',
    status: configured ? 'configured' : 'missing',
    installed: false,
    configured,
    runnable: false,
    command: null,
    version: null,
    credentialSources,
    smokeCommand: null,
    notes: ['Tracked for Hermes parity; Code Buddy does not yet expose a first-class Browser Use runtime runner.'],
    remediation: ['Use local Playwright today, or wire the Nous Tool Gateway before claiming Browser Use backend parity.'],
  };
}

function firecrawlBackend(env: NodeJS.ProcessEnv): HermesBrowserBackend {
  const credentialSources = presentEnvKeys(env, ['FIRECRAWL_API_KEY']);
  const configured = credentialSources.length > 0;
  return {
    id: 'firecrawl',
    label: 'Firecrawl',
    officialSurface: 'web extraction backend',
    status: configured ? 'configured' : 'available',
    installed: true,
    configured,
    runnable: configured,
    command: null,
    version: null,
    credentialSources,
    smokeCommand: configured ? 'buddy hermes portal tools --json' : null,
    notes: ['Code Buddy has a native Firecrawl tool surface; live calls require FIRECRAWL_API_KEY.'],
    remediation: configured ? [] : ['Set FIRECRAWL_API_KEY when live Firecrawl extraction is required.'],
  };
}

function camofoxBackend(env: NodeJS.ProcessEnv): HermesBrowserBackend {
  const camofox = runProbe('camofox', ['--version'], env);
  const camoufox = camofox.ok ? camofox : runProbe('camoufox', ['--version'], env);
  const installed = camoufox.ok;
  return {
    id: 'camofox',
    label: 'Camofox / Camoufox',
    officialSurface: 'anti-detection browser backend',
    status: installed ? 'available' : 'missing',
    installed,
    configured: installed,
    runnable: false,
    command: installed ? (camofox.ok ? 'camofox' : 'camoufox') : null,
    version: installed ? firstLine(camoufox.output) : null,
    credentialSources: [],
    smokeCommand: null,
    notes: ['Detected only as an optional upstream-compatible backend; no Code Buddy runner is wired yet.'],
    remediation: installed ? ['Wire a first-class runner before claiming Camofox parity.'] : ['Install Camofox/Camoufox only if this backend is required.'],
  };
}

function recordingBackend(): HermesBrowserBackend {
  const version = packageVersion('playwright');
  const installed = Boolean(version);
  return {
    id: 'session-recording',
    label: 'Browser session recording',
    officialSurface: 'browser session replay/recording',
    status: installed ? 'available' : 'missing',
    installed,
    configured: installed,
    runnable: installed,
    command: installed ? commandDisplayName(process.execPath) : null,
    version,
    credentialSources: [],
    smokeCommand: installed ? 'buddy hermes browser-smoke local-playwright --json' : null,
    notes: [
      installed
        ? 'The local Playwright smoke writes a trace.zip session recording artifact for replay/debugging.'
        : 'Browser Operator exports proof artifacts and action logs, but Playwright trace recording is unavailable.',
    ],
    remediation: installed ? [] : ['Install Playwright before marking browser session recording as available.'],
  };
}

function buildHybridRoutePlan(backends: HermesBrowserBackend[]): HermesBrowserBackendRoutePlan {
  const remoteCdp = backends.find((backend) => backend.id === 'remote-cdp' && backend.runnable);
  const localPlaywright = backends.find((backend) => backend.id === 'local-playwright' && backend.runnable);
  const runnableSafeBackends = [remoteCdp, localPlaywright].filter(Boolean) as HermesBrowserBackend[];
  const gatedBackends = buildBrowserRouteGates(backends);
  const primary = runnableSafeBackends[0] ?? null;
  const fallbacks = runnableSafeBackends
    .filter((backend) => backend.id !== primary?.id)
    .map((backend) => backend.id);

  if (!primary) {
    return {
      autoEligibleBackendIds: [],
      fallbackBackendIds: [],
      gatedBackendIds: gatedBackends.map((backend) => backend.backendId),
      gatedBackends,
      mode: 'hybrid',
      primaryBackendId: null,
      reason: 'No safe browser backend is currently runnable; configure Playwright or a CDP endpoint first.',
      smokeCommand: null,
    };
  }

  return {
    autoEligibleBackendIds: runnableSafeBackends.map((backend) => backend.id),
    fallbackBackendIds: fallbacks,
    gatedBackendIds: gatedBackends.map((backend) => backend.backendId),
    gatedBackends,
    mode: 'hybrid',
    primaryBackendId: primary.id,
    reason: fallbacks.length > 0
      ? `Auto browser smoke will use ${primary.label}, with ${fallbacks.join(', ')} as fallback candidates.`
      : `Auto browser smoke will use ${primary.label}; no secondary safe backend is currently runnable.`,
    smokeCommand: 'buddy hermes browser-smoke auto --json',
  };
}

function buildBrowserRouteGates(backends: HermesBrowserBackend[]): HermesBrowserBackendRouteGate[] {
  return backends.flatMap((backend) => {
    const reason = browserRouteGateReason(backend);
    return reason
      ? [{
        backendId: backend.id,
        label: backend.label,
        reason,
        smokeCommand: backend.smokeCommand,
      }]
      : [];
  });
}

function browserRouteGateReason(backend: HermesBrowserBackend): string | null {
  if (['local-playwright', 'remote-cdp', 'session-recording'].includes(backend.id)) {
    return null;
  }

  if (backend.id === 'browserbase' && backend.configured) {
    return 'Browserbase is configured but excluded from auto browser routing; use the explicit smoke runner for managed sessions.';
  }

  if (backend.id === 'browser-use' && backend.configured) {
    return 'Browser Use is configured but excluded from auto browser routing until the Nous Tool Gateway runner is wired.';
  }

  if (backend.id === 'firecrawl' && backend.configured) {
    return 'Firecrawl is configured but excluded from auto browser routing because it is an extraction backend, not an interactive browser session.';
  }

  if (backend.id === 'camofox' && backend.installed) {
    return 'Camofox/Camoufox is installed but excluded from auto browser routing until a first-class runner exists.';
  }

  return null;
}

export function buildHermesBrowserBackendsReadiness(
  options: HermesBrowserBackendsOptions = {},
): HermesBrowserBackendsReadiness {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const backends = [
    localPlaywrightBackend(),
    cdpBackend(env),
    browserbaseBackend(env),
    browserUseBackend(env),
    firecrawlBackend(env),
    camofoxBackend(env),
    recordingBackend(),
  ];
  const localRunnableCount = backends.filter((backend) =>
    ['local-playwright', 'remote-cdp'].includes(backend.id) && backend.runnable,
  ).length;
  const managedConfiguredCount = backends.filter((backend) =>
    ['browserbase', 'browser-use', 'firecrawl'].includes(backend.id) && backend.configured,
  ).length;
  const routePlan = buildHybridRoutePlan(backends);
  const issues: string[] = [];
  const recommendations: string[] = [];

  if (localRunnableCount === 0) {
    issues.push('No local browser backend is currently runnable (Playwright or configured CDP).');
  }

  if (managedConfiguredCount === 0) {
    recommendations.push('Configure Browserbase, Browser Use/Nous Gateway, or Firecrawl only if managed browser backends are a product goal.');
  }

  if (!backends.some((backend) => backend.id === 'session-recording' && backend.runnable)) {
    recommendations.push('Add a real browser session recording artifact before claiming full Hermes browser backend parity.');
  }

  return {
    ok: issues.length === 0,
    generatedAt: now().toISOString(),
    platform: process.platform,
    localRunnableCount,
    managedConfiguredCount,
    routePlan,
    backends,
    issues,
    recommendations,
  };
}

function blockedSmokeResult(
  backendId: string,
  status: HermesBrowserSmokeStatus,
  output: string,
  options: {
    backend?: HermesBrowserBackend;
    command?: string | null;
    now: Date;
  },
): HermesBrowserBackendSmokeResult {
  const timestamp = options.now.toISOString();
  return {
    backendId,
    command: options.command ?? null,
    durationMs: 0,
    finishedAt: timestamp,
    label: options.backend?.label ?? null,
    ok: false,
    output,
    startedAt: timestamp,
    status,
    stdout: '',
    stderr: output,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cdpEndpointFromEnv(env: NodeJS.ProcessEnv): string | null {
  for (const key of ['CODEBUDDY_BROWSER_CDP_URL', 'BROWSER_CDP_URL', 'CHROME_REMOTE_DEBUGGING_URL']) {
    const value = env[key]?.trim();
    if (value) return value;
  }

  return null;
}

async function createBrowserSmokeArtifactDir(artifactsDir?: string): Promise<string> {
  if (artifactsDir?.trim()) {
    const target = resolve(artifactsDir);
    await mkdir(target, { recursive: true });
    return target;
  }

  return mkdtemp(join(tmpdir(), 'codebuddy-hermes-browser-'));
}

async function runRemoteCdpSmoke(
  now: () => Date,
  env: NodeJS.ProcessEnv,
): Promise<HermesBrowserBackendSmokeResult> {
  const started = now();
  const startedAtMs = Date.now();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    const endpoint = cdpEndpointFromEnv(env);
    if (!endpoint) {
      return {
        backendId: 'remote-cdp',
        command: null,
        durationMs: Math.max(0, Date.now() - startedAtMs),
        finishedAt: now().toISOString(),
        label: 'Remote Chrome DevTools Protocol',
        ok: false,
        output: 'CODEBUDDY_BROWSER_CDP_URL is required for remote-cdp smoke.',
        startedAt: started.toISOString(),
        status: 'not-runnable',
        stdout: '',
        stderr: 'CODEBUDDY_BROWSER_CDP_URL is required for remote-cdp smoke.',
      };
    }

    const playwright = await import('playwright');
    browser = await playwright.chromium.connectOverCDP(endpoint);
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('data:text/html,<title>OK-HERMES-CDP</title><h1>OK-HERMES-CDP</h1>', {
      waitUntil: 'domcontentloaded',
    });
    const title = await page.title();
    const heading = await page.locator('h1').textContent();
    const ok = title === 'OK-HERMES-CDP' && heading === 'OK-HERMES-CDP';
    const output = `title=${title}; heading=${heading ?? ''}`;

    return {
      backendId: 'remote-cdp',
      command: null,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      finishedAt: now().toISOString(),
      label: 'Remote Chrome DevTools Protocol',
      ok,
      output,
      startedAt: started.toISOString(),
      status: ok ? 'passed' : 'failed',
      stdout: output,
      stderr: ok ? '' : 'Unexpected remote CDP page content.',
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      backendId: 'remote-cdp',
      command: null,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      finishedAt: now().toISOString(),
      label: 'Remote Chrome DevTools Protocol',
      ok: false,
      output: message,
      startedAt: started.toISOString(),
      status: 'failed',
      stdout: '',
      stderr: message,
    };
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

function resolveStagehandActivePage(stagehand: {
  page?: unknown;
  context?: {
    activePage?: () => unknown;
    pages?: (() => unknown[]) | unknown[];
  };
}): unknown | null {
  if (stagehand.page) {
    return stagehand.page;
  }

  const context = stagehand.context;
  if (!context) return null;

  if (typeof context.activePage === 'function') {
    const activePage = context.activePage();
    if (activePage) return activePage;
  }

  if (typeof context.pages === 'function') {
    return context.pages()[0] ?? null;
  }

  if (Array.isArray(context.pages)) {
    return context.pages[0] ?? null;
  }

  return null;
}

async function runBrowserbaseSmoke(now: () => Date, env: NodeJS.ProcessEnv): Promise<HermesBrowserBackendSmokeResult> {
  const started = now();
  const startedAtMs = Date.now();

  const apiKey = env.BROWSERBASE_API_KEY?.trim();
  const projectId = env.BROWSERBASE_PROJECT_ID?.trim();
  if (!apiKey || !projectId) {
    return {
      backendId: 'browserbase',
      command: null,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      finishedAt: now().toISOString(),
      label: 'Browserbase / Stagehand',
      ok: false,
      output: 'BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are required for browserbase smoke.',
      startedAt: started.toISOString(),
      status: 'not-runnable',
      stdout: '',
      stderr: 'BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are required for browserbase smoke.',
    };
  }

  let stagehand: {
    browserbaseDebugURL?: string;
    browserbaseSessionID?: string;
    browserbaseSessionURL?: string;
    close: () => Promise<void>;
    context?: unknown;
    init: () => Promise<void>;
    page?: unknown;
  } | null = null;

  try {
    const { Stagehand } = await import('@browserbasehq/stagehand');
    stagehand = new Stagehand({
      env: 'BROWSERBASE',
      apiKey,
      projectId,
      verbose: 0,
      localBrowserLaunchOptions: {
        headless: true,
      },
    }) as unknown as {
      browserbaseDebugURL?: string;
      browserbaseSessionID?: string;
      browserbaseSessionURL?: string;
      close: () => Promise<void>;
      context?: unknown;
      init: () => Promise<void>;
      page?: unknown;
    };

    await stagehand.init();
    const page = resolveStagehandActivePage(stagehand as {
      page?: unknown;
      context?: {
        activePage?: () => unknown;
        pages?: (() => unknown[]) | unknown[];
      };
    });

    if (!page) {
      throw new Error('Stagehand did not expose a browser page instance.');
    }

  const browserPage = page as {
      goto?: (url: string, options?: { waitUntil?: string }) => Promise<void>;
      locator?: (selector: string) => { textContent?: () => Promise<string | null> };
      title?: () => Promise<string>;
    };

    if (!browserPage.goto || !browserPage.locator || !browserPage.title) {
      throw new Error('Stagehand browser page is missing the browser APIs required for smoke validation.');
    }

    await browserPage.goto('data:text/html,<title>OK-HERMES-BROWSERBASE</title><h1>OK-HERMES-BROWSERBASE</h1>', {
      waitUntil: 'domcontentloaded',
    });
    const title = await browserPage.title();
    const heading = await browserPage.locator('h1').textContent?.();
    const ok = title === 'OK-HERMES-BROWSERBASE' && heading === 'OK-HERMES-BROWSERBASE';
    const output = `title=${title}; heading=${heading ?? ''}`;

    return {
      backendId: 'browserbase',
      command: null,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      finishedAt: now().toISOString(),
      label: 'Browserbase / Stagehand',
      ok,
      output,
      startedAt: started.toISOString(),
      status: ok ? 'passed' : 'failed',
      stdout: output,
      stderr: ok ? '' : 'Unexpected Browserbase page content.',
      session: {
        debugUrl: stagehand.browserbaseDebugURL,
        id: stagehand.browserbaseSessionID,
        url: stagehand.browserbaseSessionURL,
      },
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      backendId: 'browserbase',
      command: null,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      finishedAt: now().toISOString(),
      label: 'Browserbase / Stagehand',
      ok: false,
      output: message,
      startedAt: started.toISOString(),
      status: 'failed',
      stdout: '',
      stderr: message,
      session: stagehand
        ? {
          debugUrl: stagehand.browserbaseDebugURL,
          id: stagehand.browserbaseSessionID,
          url: stagehand.browserbaseSessionURL,
        }
        : undefined,
    };
  } finally {
    if (stagehand?.close) {
      await stagehand.close().catch(() => undefined);
    }
  }
}

async function runLocalPlaywrightSmoke(
  now: () => Date,
  options: { artifactsDir?: string } = {},
): Promise<HermesBrowserBackendSmokeResult> {
  const started = now();
  const startedAtMs = Date.now();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    const playwright = await import('playwright');
    browser = await playwright.chromium.launch({ headless: true });
    context = await browser.newContext();
    const artifactDir = await createBrowserSmokeArtifactDir(options.artifactsDir);
    const tracePath = join(artifactDir, 'local-playwright-trace.zip');

    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: false,
    });

    const page = await context.newPage();
    await page.goto('data:text/html,<title>OK-HERMES-BROWSER</title><h1>OK-HERMES-BROWSER</h1>', {
      waitUntil: 'domcontentloaded',
    });
    const title = await page.title();
    const heading = await page.locator('h1').textContent();
    const pageOk = title === 'OK-HERMES-BROWSER' && heading === 'OK-HERMES-BROWSER';
    let traceError: string | null = null;

    try {
      await context.tracing.stop({ path: tracePath });
    } catch (error) {
      traceError = errorMessage(error);
    }

    const traceStats = traceError ? null : await stat(tracePath).catch(() => null);
    const traceExists = Boolean(traceStats?.isFile() && traceStats.size > 0);
    if (!traceError && !traceExists) {
      traceError = 'Playwright trace recording was not written.';
    }

    const artifacts: HermesBrowserSmokeArtifact[] = traceStats
      ? [{
        exists: traceExists,
        kind: 'playwright-trace',
        label: 'Local Playwright trace',
        path: tracePath,
        sizeBytes: traceStats.size,
      }]
      : [];
    const ok = pageOk && !traceError && traceExists;
    const output = `title=${title}; heading=${heading ?? ''}; trace=${tracePath}`;
    return {
      artifacts,
      backendId: 'local-playwright',
      command: process.execPath,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      finishedAt: now().toISOString(),
      label: 'Local Playwright',
      ok,
      output,
      startedAt: started.toISOString(),
      status: ok ? 'passed' : 'failed',
      stdout: output,
      stderr: [
        pageOk ? null : 'Unexpected browser page content.',
        traceError,
      ].filter(Boolean).join('\n'),
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      backendId: 'local-playwright',
      command: process.execPath,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      finishedAt: now().toISOString(),
      label: 'Local Playwright',
      ok: false,
      output: message,
      startedAt: started.toISOString(),
      status: 'failed',
      stdout: '',
      stderr: message,
    };
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

export async function runHermesBrowserBackendSmoke(
  options: HermesBrowserBackendSmokeOptions,
): Promise<HermesBrowserBackendSmokeResult> {
  const env = options.cdpUrl?.trim()
    ? { ...(options.env ?? process.env), CODEBUDDY_BROWSER_CDP_URL: options.cdpUrl.trim() }
    : options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const readiness = buildHermesBrowserBackendsReadiness({ env, now });
  const backendId = options.backendId.trim();
  const timestamp = now();
  if (backendId === 'auto') {
    const primaryBackendId = readiness.routePlan.primaryBackendId;
    if (!primaryBackendId) {
      return blockedSmokeResult('auto', 'not-runnable', readiness.routePlan.reason, {
        command: readiness.routePlan.smokeCommand,
        now: timestamp,
      });
    }

    // Hybrid routing: try the primary backend first, then fall back through the
    // remaining runnable safe candidates in order. The first backend that passes
    // serves the request; if none pass, the primary's failure is returned so the
    // caller still sees the most representative diagnostic.
    const candidates = [primaryBackendId, ...readiness.routePlan.fallbackBackendIds];
    const attempts: HermesBrowserSmokeRouteAttempt[] = [];
    let firstResult: HermesBrowserBackendSmokeResult | null = null;

    for (const candidate of candidates) {
      const candidateResult = await runHermesBrowserBackendSmoke({
        ...options,
        backendId: candidate,
        env,
        now,
      });
      attempts.push({
        backendId: candidate,
        ok: candidateResult.ok,
        status: candidateResult.status,
      });
      if (!firstResult) {
        firstResult = candidateResult;
      }
      if (candidateResult.ok) {
        return {
          ...candidateResult,
          route: {
            attempts,
            requested: 'auto',
            servedBy: candidate,
            usedFallback: candidate !== primaryBackendId,
          },
        };
      }
    }

    // Every candidate failed — surface the primary attempt with the full chain.
    const exhausted = firstResult as HermesBrowserBackendSmokeResult;
    return {
      ...exhausted,
      route: {
        attempts,
        requested: 'auto',
        servedBy: exhausted.backendId,
        usedFallback: false,
      },
    };
  }

  const backend = readiness.backends.find((candidate) => candidate.id === backendId);

  if (!backend) {
    return blockedSmokeResult(backendId, 'unsupported', `Unknown browser backend: ${backendId}`, {
      now: timestamp,
    });
  }

  if (backend.id === 'local-playwright') {
    return runLocalPlaywrightSmoke(now, { artifactsDir: options.artifactsDir });
  }

  if (backend.id === 'remote-cdp') {
    return runRemoteCdpSmoke(now, env);
  }

  if (backend.id === 'browserbase') {
    return runBrowserbaseSmoke(now, env);
  }

  if (!backend.runnable) {
    return blockedSmokeResult(backend.id, 'not-runnable', `${backend.label} is not runnable on this host.`, {
      backend,
      command: backend.command,
      now: timestamp,
    });
  }

  return blockedSmokeResult(backend.id, 'blocked', `${backend.label} does not have a safe live smoke runner yet.`, {
    backend,
    command: backend.command,
    now: timestamp,
  });
}

export function renderHermesBrowserBackendsReadiness(readiness: HermesBrowserBackendsReadiness): string {
  const lines = [
    `Hermes browser backends: ${readiness.ok ? 'ok' : 'needs attention'}`,
    `Platform: ${readiness.platform}`,
    `Local runnable: ${readiness.localRunnableCount}`,
    `Managed configured: ${readiness.managedConfiguredCount}`,
    `Hybrid route: ${readiness.routePlan.primaryBackendId ?? 'none'}` +
      `${readiness.routePlan.smokeCommand ? ` | smoke: ${readiness.routePlan.smokeCommand}` : ''}`,
    '',
    'Backends:',
    ...readiness.backends.map(renderBrowserBackendLine),
  ];

  if (readiness.issues.length > 0) {
    lines.push('', 'Issues:', ...readiness.issues.map((issue) => `- ${issue}`));
  }

  if (readiness.recommendations.length > 0) {
    lines.push('', 'Recommendations:', ...readiness.recommendations.map((recommendation) => `- ${recommendation}`));
  }

  const gatedBackends = readiness.routePlan.gatedBackends ?? [];
  if (gatedBackends.length > 0) {
    lines.push(
      '',
      'Gated auto-route backends:',
      ...gatedBackends.map((backend) => `- ${backend.backendId}: ${backend.reason}`),
    );
  }

  return lines.join('\n');
}

function renderBrowserBackendLine(backend: HermesBrowserBackend): string {
  const readinessFlags = `configured=${backend.configured ? 'yes' : 'no'}, runnable=${backend.runnable ? 'yes' : 'no'}`;

  return `- ${backend.id}: ${backend.status}` +
    `${backend.version ? ` (${backend.version})` : ''}` +
    ` | ${readinessFlags}` +
    `${backend.runnable && backend.smokeCommand ? ` | smoke: ${backend.smokeCommand}` : ''}`;
}

export function renderHermesBrowserSmoke(result: HermesBrowserBackendSmokeResult): string {
  const lines = [
    `Hermes browser smoke (${result.backendId}): ${result.status}`,
    `Command: ${result.command ?? 'none'}`,
    `Duration: ${result.durationMs}ms`,
    `Output: ${result.output || 'none'}`,
  ];

  if (result.route) {
    const chain = result.route.attempts
      .map((attempt) => `${attempt.backendId}=${attempt.status}`)
      .join(' → ');
    lines.push(
      `Hybrid route: served by ${result.route.servedBy}` +
        (result.route.usedFallback ? ' (via fallback)' : '') +
        (chain ? ` [${chain}]` : ''),
    );
  }

  if (result.artifacts?.length) {
    lines.push(
      'Artifacts:',
      ...result.artifacts.map((artifact) =>
        `- ${artifact.kind}: ${artifact.path} (${artifact.sizeBytes} bytes)`,
      ),
    );
  }

  if (result.session) {
    lines.push(
      'Session:',
      `- id: ${result.session.id ?? 'unknown'}`,
      `- url: ${result.session.url ?? 'unknown'}`,
      `${result.session.debugUrl ? `- debug: ${result.session.debugUrl}` : '- debug: unknown'}`,
    );
  }

  return lines.join('\n');
}
