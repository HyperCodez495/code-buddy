/**
 * web_test — the full develop → launch → browse → verify loop, for real:
 * a real dev server spawned by AppServerTool, a real browser session, and
 * the one-call report showing both faces of a bug (client console + server
 * logs) with declarative assertions.
 */
import net from 'net';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

import { WebTestTool } from '../../src/tools/registry/web-test-tool.js';
import { BrowserExecuteTool, resetMiscInstances } from '../../src/tools/registry/misc-tools.js';
import { getAppServerTool, resetAppServerTool } from '../../src/tools/app-server-tool.js';
import { resetDevOrigins } from '../../src/security/dev-origins.js';
import { resetProcessTool } from '../../src/tools/process-tool.js';

async function freePort(): Promise<number> {
  return await new Promise<number>((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

/** A real "dev server": /good is healthy, /bad throws in the client. */
function appCommand(port: number): string {
  const js = [
    'const http=require("http");',
    'http.createServer((q,s)=>{',
    'console.log("SERVER hit "+q.url);',
    's.setHeader("Content-Type","text/html");',
    'if(q.url==="/bad"){s.end("<!doctype html><title>Broken app</title><h1>Oops</h1><script>console.error(\\"boom client\\");throw new Error(\\"page boom\\")</script>")}',
    'else{s.end("<!doctype html><title>My app</title><h1>Welcome to my app</h1><button id=\\"cta\\">Start</button>")}',
    `}).listen(${port},"127.0.0.1",()=>console.log("SERVER listening"));`,
  ].join('');
  return `node -e '${js}'`;
}

describe('web_test (real app_server + real browser)', () => {
  const webTest = new WebTestTool();
  const browser = new BrowserExecuteTool();

  afterEach(async () => {
    await browser.execute({ action: 'close' }).catch(() => {});
    // web_test reads server logs through the app_server singleton — the test
    // goes through the same instance the real wiring uses.
    await resetAppServerTool();
    resetMiscInstances();
    resetDevOrigins();
    resetProcessTool();
    const { resetBrowserManager, resetBrowserTool } = await import('../../src/browser-automation/index.js');
    resetBrowserTool();
    resetBrowserManager();
  });

  it('full loop: launch app → failing report with both bug faces → passing report on the fixed page', async () => {
    const appServer = getAppServerTool();
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const started = await appServer.start({ command: appCommand(port), url: `${base}/`, timeoutMs: 15_000 });
    expect(started.success, started.error).toBe(true);

    // The broken page: console error + missing expected text.
    const bad = await webTest.execute({
      url: `${base}/bad`,
      assertions: [
        { type: 'text', value: 'Welcome to my app' },
        { type: 'title', value: 'My app' },
      ],
    });
    expect(bad.success, bad.error).toBe(true);
    const badData = bad.data as { passed: boolean; consoleErrorCount: number };
    expect(badData.passed).toBe(false);
    expect(badData.consoleErrorCount).toBeGreaterThan(0);
    expect(bad.output).toContain('FAILED');
    expect(bad.output).toContain('boom client');
    expect(bad.output).toContain('✗ assert text "Welcome to my app"');
    // Server face: app_server logs are in the same report.
    expect(bad.output).toContain('Server logs (app_server)');
    expect(bad.output).toContain('SERVER hit /bad');

    // The "fixed" page passes, with evidence.
    const good = await webTest.execute({
      url: `${base}/`,
      assertions: [
        { type: 'text', value: 'Welcome to my app' },
        { type: 'selector', value: '#cta' },
        { type: 'title', value: 'My app' },
      ],
    });
    expect(good.success, good.error).toBe(true);
    expect((good.data as { passed: boolean }).passed).toBe(true);
    expect(good.output).toContain('PASSED');
    expect(good.output).toContain('✓ console: no console/page errors');
    expect(good.output).toContain('✓ assert selector "#cta"');
    expect((good.data as { screenshotPath?: string }).screenshotPath).toBeTruthy();
  });

  it('an unregistered loopback URL fails at navigation and says why', async () => {
    const result = await webTest.execute({ url: 'http://127.0.0.1:59999/' });
    expect(result.success).toBe(true);
    expect((result.data as { passed: boolean }).passed).toBe(false);
    expect(result.output).toContain('✗ navigation');
  });
});
