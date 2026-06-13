import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, dirname, join, resolve } from 'path';
import { createServer } from 'net';
import { chromium } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'url';

vi.setConfig({ testTimeout: 60_000 });

const mockStagehandInit = vi.fn().mockResolvedValue(undefined);
const mockStagehandClose = vi.fn().mockResolvedValue(undefined);
const mockStagehandGoto = vi.fn().mockResolvedValue(undefined);
const mockStagehandTitle = vi.fn().mockResolvedValue('OK-HERMES-BROWSERBASE');
const mockStagehandTextContent = vi.fn().mockResolvedValue('OK-HERMES-BROWSERBASE');
const mockStagehandActivePage = {
  goto: mockStagehandGoto,
  locator: vi.fn().mockReturnValue({
    textContent: mockStagehandTextContent,
  }),
  title: mockStagehandTitle,
};

vi.mock('@browserbasehq/stagehand', () => {
  return {
    Stagehand: class {
      browserbaseDebugURL = 'https://browserbase.test/debug/abc';
      browserbaseSessionID = 'session-abc';
      browserbaseSessionURL = 'https://browserbase.test/session/abc';
      context = {
        activePage: () => mockStagehandActivePage,
        pages: () => [mockStagehandActivePage],
      };

      init = mockStagehandInit;
      close = mockStagehandClose;
    },
  };
});

import {
  buildHermesBrowserBackendsReadiness,
  renderHermesBrowserBackendsReadiness,
  runHermesBrowserBackendSmoke,
  type HermesBrowserBackendsReadiness,
} from '../../src/agent/hermes-browser-backends.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const nodeDisplayCommand = basename(process.execPath);

async function launchLocalCdpBrowser(): Promise<{
  endpoint: string;
  kill: () => Promise<void>;
}> {
  const port = await new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') {
          resolvePort(address.port);
          return;
        }
        rejectPort(new Error('Unable to reserve a free port.'));
      });
    });
  });
  const userDataDir = await mkdtemp(join(tmpdir(), 'codebuddy-hermes-cdp-'));
  const processRef = spawn(chromium.executablePath(), [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--no-sandbox',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-gpu',
    '--no-default-browser-check',
    '--no-first-run',
    'about:blank',
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;

  let stderr = '';
  const endpoint = await new Promise<string>((resolveEndpoint, rejectEndpoint) => {
    let settled = false;
    const timeout = setTimeout(() => {
      rejectEndpoint(new Error(`Timed out waiting for local CDP endpoint: ${stderr || 'no response'}`));
    }, 30_000);

    const finalize = (error: Error | null, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        rejectEndpoint(error);
        return;
      }
      resolveEndpoint(value ?? '');
    };

    processRef.stderr.setEncoding('utf8');
    processRef.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      for (const line of chunk.split(/\r?\n/)) {
        const match = line.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match?.[1]) {
          finalize(null, match[1]);
          return;
        }
      }
    });

    processRef.once('error', (error) => {
      finalize(error instanceof Error ? error : new Error(String(error)));
    });

    processRef.once('exit', (code, signal) => {
      finalize(new Error(`CDP browser exited before endpoint was ready (code=${code ?? 'null'}, signal=${signal ?? 'none'}).`));
    });
  });

  return {
    endpoint,
    kill: async () => {
      if (!processRef.killed) {
        processRef.kill();
      }
      await new Promise((resolveExit) => {
        processRef.once('exit', resolveExit);
        setTimeout(resolveExit, 2000);
      });
      await rm(userDataDir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

function runHermesJson(args: string[]): unknown {
  const result = spawnSync(process.execPath, [tsxCli, 'src/index.ts', 'hermes', ...args, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 90_000,
    windowsHide: true,
  });

  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toMatch(/^\{/);
  return JSON.parse(result.stdout) as unknown;
}

describe('Hermes browser backend readiness and live smoke', () => {
  it('renders browser backend readiness flags without smoke commands for non-runnable backends', () => {
    const readiness: HermesBrowserBackendsReadiness = {
      ok: true,
      generatedAt: '2026-06-01T03:15:00.000Z',
      platform: process.platform,
      localRunnableCount: 1,
      managedConfiguredCount: 0,
      routePlan: {
        autoEligibleBackendIds: ['local-playwright'],
        fallbackBackendIds: [],
        gatedBackendIds: [],
        gatedBackends: [],
        mode: 'hybrid',
        primaryBackendId: 'local-playwright',
        reason: 'local Playwright is safe by default',
        smokeCommand: 'buddy hermes browser-smoke auto --json',
      },
      backends: [
        {
          id: 'local-playwright',
          label: 'Local Playwright',
          officialSurface: 'local CDP/Playwright browser backend',
          status: 'available',
          installed: true,
          configured: true,
          runnable: true,
          command: process.execPath,
          version: '1.test',
          credentialSources: [],
          smokeCommand: 'buddy hermes browser-smoke local-playwright --json',
          notes: [],
          remediation: [],
        },
        {
          id: 'browserbase',
          label: 'Browserbase / Stagehand',
          officialSurface: 'managed browser backend',
          status: 'available',
          installed: true,
          configured: false,
          runnable: false,
          command: null,
          version: '3.test',
          credentialSources: [],
          smokeCommand: 'buddy hermes browser-smoke browserbase --json',
          notes: [],
          remediation: [],
        },
      ],
      issues: [],
      recommendations: [],
    };

    const output = renderHermesBrowserBackendsReadiness(readiness);

    expect(output).toContain(
      '- local-playwright: available (1.test) | configured=yes, runnable=yes | smoke: buddy hermes browser-smoke local-playwright --json',
    );
    expect(output).toContain('- browserbase: available (3.test) | configured=no, runnable=no');
    expect(output).not.toContain('smoke: buddy hermes browser-smoke browserbase --json');
  });

  it('reports browser backend readiness without leaking configured secrets', () => {
    const readiness = buildHermesBrowserBackendsReadiness({
      env: {
        CODEBUDDY_BROWSER_CDP_URL: 'ws://secret-cdp-host.example.test/devtools/browser/abc',
        BROWSERBASE_API_KEY: 'secret-browserbase-key',
        BROWSERBASE_PROJECT_ID: 'secret-browserbase-project',
        BROWSER_USE_API_KEY: 'secret-browser-use-key',
        FIRECRAWL_API_KEY: 'secret-firecrawl-key',
      },
      now: () => new Date('2026-05-31T13:35:00.000Z'),
    });

    expect(readiness.generatedAt).toBe('2026-05-31T13:35:00.000Z');
    expect(readiness.backends.map((backend) => backend.id)).toEqual(
      expect.arrayContaining([
        'local-playwright',
        'remote-cdp',
        'browserbase',
        'browser-use',
        'firecrawl',
        'camofox',
        'session-recording',
      ]),
    );
    expect(readiness.localRunnableCount).toBeGreaterThanOrEqual(1);
    expect(readiness.managedConfiguredCount).toBe(3);
    expect(readiness.routePlan).toEqual(expect.objectContaining({
      fallbackBackendIds: expect.arrayContaining(['local-playwright']),
      mode: 'hybrid',
      primaryBackendId: 'remote-cdp',
      smokeCommand: 'buddy hermes browser-smoke auto --json',
    }));
    expect(readiness.routePlan.autoEligibleBackendIds).toEqual(expect.arrayContaining([
      'remote-cdp',
      'local-playwright',
    ]));
    expect(readiness.routePlan.gatedBackendIds).toEqual(expect.arrayContaining([
      'browserbase',
      'browser-use',
      'firecrawl',
    ]));
    expect(readiness.routePlan.gatedBackends).toEqual(expect.arrayContaining([
      expect.objectContaining({
        backendId: 'browserbase',
        reason: expect.stringContaining('explicit smoke runner'),
      }),
      expect.objectContaining({
        backendId: 'firecrawl',
        reason: expect.stringContaining('extraction backend'),
      }),
    ]));
    expect(readiness.backends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local-playwright',
          command: nodeDisplayCommand,
          runnable: true,
          smokeCommand: 'buddy hermes browser-smoke local-playwright --json',
          status: 'available',
        }),
        expect.objectContaining({
          id: 'remote-cdp',
          credentialSources: ['CODEBUDDY_BROWSER_CDP_URL'],
          runnable: true,
          smokeCommand: 'buddy hermes browser-smoke remote-cdp --json',
          status: 'configured',
        }),
        expect.objectContaining({
          id: 'browserbase',
          configured: true,
          credentialSources: ['BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID'],
          runnable: true,
          smokeCommand: 'buddy hermes browser-smoke browserbase --json',
          status: 'configured',
        }),
        expect.objectContaining({
          id: 'session-recording',
          command: nodeDisplayCommand,
          runnable: true,
          smokeCommand: 'buddy hermes browser-smoke local-playwright --json',
          status: 'available',
        }),
      ]),
    );
    const rendered = renderHermesBrowserBackendsReadiness(readiness);
    expect(rendered).toContain('Gated auto-route backends:');
    expect(rendered).toContain('- browserbase: Browserbase is configured but excluded from auto browser routing');
    expect(JSON.stringify(readiness)).not.toContain('secret-');
    expect(JSON.stringify(readiness)).not.toContain('ws://secret-cdp-host');
    expect(JSON.stringify(readiness)).not.toContain(process.execPath);
  });

  it('shows a remote CDP one-shot smoke command without requiring a configured endpoint', () => {
    const readiness = buildHermesBrowserBackendsReadiness({
      env: {},
      now: () => new Date('2026-06-01T12:30:00.000Z'),
    });

    const remoteCdp = readiness.backends.find((backend) => backend.id === 'remote-cdp');

    expect(remoteCdp).toMatchObject({
      configured: false,
      runnable: false,
      smokeCommand: null,
    });
    expect(remoteCdp?.remediation).toContain(
      'Or run buddy hermes browser-smoke remote-cdp --cdp-url <ws-endpoint> --json for a one-shot proof.',
    );
    expect(JSON.stringify(remoteCdp)).not.toContain('ws://');
  });

  it('launches Chromium through a real local Playwright smoke', async () => {
    const result = await runHermesBrowserBackendSmoke({
      backendId: 'local-playwright',
      now: () => new Date('2026-05-31T13:36:00.000Z'),
    });

    expect(result).toMatchObject({
      backendId: 'local-playwright',
      command: process.execPath,
      ok: true,
      status: 'passed',
    });
    expect(result.stdout).toContain('OK-HERMES-BROWSER');
    expect(result.output).toContain('OK-HERMES-BROWSER');
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exists: true,
          kind: 'playwright-trace',
          sizeBytes: expect.any(Number),
        }),
      ]),
    );
    expect(result.artifacts?.[0]?.sizeBytes).toBeGreaterThan(0);
  });

  it('runs the Browserbase smoke through Stagehand when configured', async () => {
    const result = await runHermesBrowserBackendSmoke({
      backendId: 'browserbase',
      env: {
        ...process.env,
        BROWSERBASE_API_KEY: 'secret-browserbase-key',
        BROWSERBASE_PROJECT_ID: 'secret-browserbase-project',
      },
      now: () => new Date('2026-05-31T13:36:30.000Z'),
    });

    expect(result).toMatchObject({
      backendId: 'browserbase',
      command: null,
      ok: true,
      status: 'passed',
    });
    expect(result.session).toMatchObject({
      id: 'session-abc',
      url: 'https://browserbase.test/session/abc',
      debugUrl: 'https://browserbase.test/debug/abc',
    });
    expect(result.stdout).toContain('OK-HERMES-BROWSERBASE');
    expect(result.output).toContain('OK-HERMES-BROWSERBASE');
    expect(JSON.stringify(result)).not.toContain('secret-browserbase-key');
    expect(JSON.stringify(result)).not.toContain('secret-browserbase-project');
  });

  it('routes auto browser smoke to a real safe backend', async () => {
    const result = await runHermesBrowserBackendSmoke({
      backendId: 'auto',
      now: () => new Date('2026-05-31T13:37:00.000Z'),
    });

    expect(result).toMatchObject({
      backendId: 'local-playwright',
      command: process.execPath,
      ok: true,
      status: 'passed',
    });
    expect(result.stdout).toContain('OK-HERMES-BROWSER');
    expect(result.artifacts?.[0]?.sizeBytes).toBeGreaterThan(0);
  });

  it('falls back to a runnable backend when the auto primary fails', async () => {
    // Configuring an (unreachable) CDP endpoint promotes remote-cdp to the
    // hybrid-route primary; it fails to connect, so auto routing must fall back
    // to the real local Playwright backend instead of returning the failure.
    const result = await runHermesBrowserBackendSmoke({
      backendId: 'auto',
      env: { ...process.env, CODEBUDDY_BROWSER_CDP_URL: 'http://127.0.0.1:1' },
      now: () => new Date('2026-05-31T14:00:00.000Z'),
    });

    expect(result).toMatchObject({
      backendId: 'local-playwright',
      ok: true,
      status: 'passed',
    });
    expect(result.route).toMatchObject({
      requested: 'auto',
      servedBy: 'local-playwright',
      usedFallback: true,
    });
    expect(result.route?.attempts).toEqual([
      { backendId: 'remote-cdp', ok: false, status: 'failed' },
      { backendId: 'local-playwright', ok: true, status: 'passed' },
    ]);
    // The unreachable endpoint must not leak into the routed result.
    expect(JSON.stringify(result)).not.toContain('127.0.0.1:1');
  });

  it('connects to a real remote CDP endpoint without leaking the endpoint', async () => {
    const cdp = await launchLocalCdpBrowser();
    try {
      const result = await runHermesBrowserBackendSmoke({
        backendId: 'remote-cdp',
        cdpUrl: cdp.endpoint,
        now: () => new Date('2026-05-31T19:50:00.000Z'),
      });

    expect(result).toMatchObject({
      backendId: 'remote-cdp',
      ok: true,
      status: 'passed',
    });
      expect(result.stdout).toContain('OK-HERMES-CDP');
      expect(result.output).toContain('OK-HERMES-CDP');
      expect(JSON.stringify(result)).not.toContain(cdp.endpoint);
    } finally {
      await cdp.kill();
    }
  });

  it('runs the remote CDP smoke through the real CLI entrypoint', async () => {
    const cdp = await launchLocalCdpBrowser();
    try {
      const output = runHermesJson(['browser-smoke', 'remote-cdp', '--cdp-url', cdp.endpoint]) as {
        kind: string;
        result: {
          backendId: string;
          ok: boolean;
          output: string;
          status: string;
          stdout: string;
        };
      };

      expect(output.kind).toBe('hermes_browser_backend_smoke');
      expect(output.result).toMatchObject({
        backendId: 'remote-cdp',
        ok: true,
        status: 'passed',
      });
      expect(output.result.stdout).toContain('OK-HERMES-CDP');
      expect(output.result.output).toContain('OK-HERMES-CDP');
      expect(JSON.stringify(output)).not.toContain(cdp.endpoint);
    } finally {
      await cdp.kill();
    }
  });
});
