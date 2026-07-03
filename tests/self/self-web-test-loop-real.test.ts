/**
 * Dogfooding — Code Buddy tests ITSELF with its own app-testing loop:
 * app_server spawns the real `buddy server` (tsx src/index.ts server) and
 * web_test verifies, through the real browser, that
 *   1. /api/health reports status ok (liveness), and
 *   2. the dashboard stays fail-closed without an auth token (security
 *      posture — an UNAUTHORIZED response is the EXPECTED behavior).
 *
 * The same loop that tests apps the agent builds is the agent's own
 * self-test harness.
 */
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 120_000 });

import { WebTestTool } from '../../src/tools/registry/web-test-tool.js';
import { BrowserExecuteTool, resetMiscInstances } from '../../src/tools/registry/misc-tools.js';
import { getAppServerTool, resetAppServerTool } from '../../src/tools/app-server-tool.js';
import { resetDevOrigins } from '../../src/security/dev-origins.js';
import { resetProcessTool } from '../../src/tools/process-tool.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function freePort(): Promise<number> {
  return await new Promise<number>((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

describe('self-test: the app-testing loop tests Code Buddy itself', () => {
  const webTest = new WebTestTool();
  const browser = new BrowserExecuteTool();

  afterEach(async () => {
    await browser.execute({ action: 'close' }).catch(() => {});
    await resetAppServerTool();
    resetMiscInstances();
    resetDevOrigins();
    resetProcessTool();
    const { resetBrowserManager, resetBrowserTool } = await import('../../src/browser-automation/index.js');
    resetBrowserTool();
    resetBrowserManager();
  });

  it('boots its own server via app_server and verifies health + auth posture via web_test', async () => {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const started = await getAppServerTool().start({
      command: `npx tsx src/index.ts server --port ${port}`,
      url: `${base}/api/health`,
      cwd: repoRoot,
      timeoutMs: 90_000,
      // The vitest fork env (loader hooks in NODE_OPTIONS, NODE_ENV=test,
      // VITEST*) kills the spawned server — give it a clean runtime env.
      env: {
        NODE_OPTIONS: undefined,
        NODE_ENV: undefined,
        VITEST: undefined,
        VITEST_POOL_ID: undefined,
        VITEST_WORKER_ID: undefined,
      },
    });
    if (!started.success) throw new Error(`app_server start failed: ${started.error}`);
    const { pid } = started.data as { pid: number };

    // Liveness: the health endpoint answers ok, browsed like any app.
    const health = await webTest.execute({
      url: `${base}/api/health`,
      assertions: [
        { type: 'text', value: '"status":"ok"' },
        { type: 'text', value: '"checks"' },
      ],
      screenshot: false,
    });
    expect(health.success, health.error).toBe(true);
    expect((health.data as { passed: boolean }).passed).toBe(true);
    expect(health.output).toContain('✓ assert text');
    // The server face of the report is Code Buddy's own boot log.
    expect(health.output).toContain('Server logs (app_server)');

    // Security posture: the dashboard must stay fail-closed without a token.
    // The 401 response itself logs a browser console error — expected here,
    // the assertion on the UNAUTHORIZED body is the actual check.
    const dashboard = await webTest.execute({
      url: `${base}/__codebuddy__/dashboard/`,
      assertions: [{ type: 'text', value: 'UNAUTHORIZED' }],
      screenshot: false,
      allowConsoleErrors: true,
    });
    expect(dashboard.success, dashboard.error).toBe(true);
    expect((dashboard.data as { passed: boolean }).passed).toBe(true);

    const stopped = await getAppServerTool().stop(pid);
    expect(stopped.success, stopped.error).toBe(true);
  });
});
