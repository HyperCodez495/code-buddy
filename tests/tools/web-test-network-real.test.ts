/**
 * web_test — the NETWORK oracle, for real: a real dev server spawned by
 * AppServerTool and a real browser session. Proves the major bug oracle a
 * plain console/pageerror check misses — a UI that RENDERS fine but whose
 * API calls fail (4xx/5xx). The page's <h1> is present (text assertion
 * passes, console is allowed) yet web_test still FAILS the run because two
 * fetches came back 500 and 404.
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

/**
 * A real "dev server" whose UI renders perfectly but whose two API calls
 * fail: /api/broken → 500, /api/missing → 404. Every other path (including
 * favicon.ico) returns the 200 HTML page, so nothing spurious is flagged.
 */
function appCommand(port: number): string {
  const js = [
    'const http=require("http");',
    'http.createServer((q,s)=>{',
    'console.log("SERVER hit "+q.url);',
    'if(q.url==="/api/broken"){s.statusCode=500;s.setHeader("Content-Type","application/json");s.end("{\\"error\\":\\"boom\\"}");return}',
    'if(q.url==="/api/missing"){s.statusCode=404;s.end("nope");return}',
    's.setHeader("Content-Type","text/html");',
    's.end("<!doctype html><title>Net app</title><h1>Dashboard</h1><script>fetch(\\"/api/broken\\").catch(()=>{});fetch(\\"/api/missing\\").catch(()=>{})</script>");',
    `}).listen(${port},"127.0.0.1",()=>console.log("SERVER listening"));`,
  ].join('');
  return `node -e '${js}'`;
}

describe('web_test network oracle (real app_server + real browser)', () => {
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

  it('fails the run when the UI renders but API calls return 500/404, and passes with allowNetworkErrors', async () => {
    const appServer = getAppServerTool();
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const started = await appServer.start({ command: appCommand(port), url: `${base}/`, timeoutMs: 15_000 });
    expect(started.success, started.error).toBe(true);

    // console errors ALLOWED so the ONLY thing that can fail the run is the
    // network oracle — Chromium also logs failed resource loads to the
    // console, so we isolate the new check deliberately.
    const bad = await webTest.execute({
      url: `${base}/`,
      assertions: [{ type: 'text', value: 'Dashboard' }],
      allowConsoleErrors: true,
    });
    expect(bad.success, bad.error).toBe(true);
    const badData = bad.data as { passed: boolean; networkFailureCount: number };
    // The UI rendered — the text assertion passed…
    expect(bad.output).toContain('✓ assert text "Dashboard"');
    // …yet the run FAILED, purely on the network oracle.
    expect(badData.passed).toBe(false);
    expect(badData.networkFailureCount).toBeGreaterThan(0);
    expect(bad.output).toContain('FAILED');
    expect(bad.output).toContain('✗ network');
    expect(bad.output).toContain('/api/broken');
    expect(bad.output).toContain('500');
    expect(bad.output).toContain('Failed network requests:');

    // Same broken page, but network errors are explicitly tolerated → PASS.
    const ok = await webTest.execute({
      url: `${base}/`,
      assertions: [{ type: 'text', value: 'Dashboard' }],
      allowConsoleErrors: true,
      allowNetworkErrors: true,
    });
    expect(ok.success, ok.error).toBe(true);
    const okData = ok.data as { passed: boolean; networkFailureCount: number };
    expect(okData.passed).toBe(true);
    expect(okData.networkFailureCount).toBeGreaterThan(0); // still captured, just not fatal
    expect(ok.output).toContain('PASSED');
    expect(ok.output).toContain('✓ network');
  });

  it('reports no failed requests for a page with no failing API calls', async () => {
    const appServer = getAppServerTool();
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    // A clean server: everything (incl. favicon) is a 200 HTML page, no fetches.
    const cleanJs = [
      'const http=require("http");',
      'http.createServer((q,s)=>{',
      's.setHeader("Content-Type","text/html");',
      's.end("<!doctype html><title>Clean app</title><h1>All good</h1>");',
      `}).listen(${port},"127.0.0.1",()=>console.log("listening"));`,
    ].join('');
    const started = await appServer.start({ command: `node -e '${cleanJs}'`, url: `${base}/`, timeoutMs: 15_000 });
    expect(started.success, started.error).toBe(true);

    const good = await webTest.execute({
      url: `${base}/`,
      assertions: [{ type: 'text', value: 'All good' }],
    });
    expect(good.success, good.error).toBe(true);
    const goodData = good.data as { passed: boolean; networkFailureCount: number };
    expect(goodData.passed).toBe(true);
    expect(goodData.networkFailureCount).toBe(0);
    expect(good.output).toContain('✓ network: no failed requests');
  });
});
