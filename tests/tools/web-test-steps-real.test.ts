/**
 * web_test STEPS — interaction flows, for real: a real loopback dev server and
 * a real browser session. Proves web_test can test a FLOW, not just "the page
 * loads and shows X":
 *   1. type into an input + click a button → the button's handler renders a
 *      result, which the assertion then verifies (the steps show as OK checks);
 *   2. a step whose selector doesn't exist fails the run with clear evidence;
 *   3. a click that fires a broken fetch (500) is caught by the network oracle
 *      even though the text assertion passes — proving the oracles run AFTER
 *      the steps (the Potemkin "Send button that does nothing" bug).
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

import { WebTestTool, type WebTestStep } from '../../src/tools/registry/web-test-tool.js';
import { BrowserExecuteTool, resetMiscInstances } from '../../src/tools/registry/misc-tools.js';
import { resetDevOrigins } from '../../src/security/dev-origins.js';
import { serveTestPages, type TestPageServer } from '../helpers/browser-test-page.js';

describe('web_test steps (real browser + real loopback server)', () => {
  const webTest = new WebTestTool();
  const browser = new BrowserExecuteTool();
  let pages: TestPageServer | undefined;

  afterEach(async () => {
    await browser.execute({ action: 'close' }).catch(() => {});
    await pages?.close();
    pages = undefined;
    resetMiscInstances();
    resetDevOrigins();
    const { resetBrowserManager, resetBrowserTool } = await import('../../src/browser-automation/index.js');
    resetBrowserTool();
    resetBrowserManager();
  });

  it('plays a type + click flow, then verifies the result — steps show as OK checks', async () => {
    pages = await serveTestPages(`<!doctype html>
      <title>Greeter</title>
      <input id="name" />
      <button id="go">Go</button>
      <script>
        document.getElementById('go').addEventListener('click', () => {
          const v = document.getElementById('name').value;
          const h = document.createElement('h1');
          h.id = 'out';
          h.textContent = 'Bonjour ' + v;
          document.body.appendChild(h);
        });
      </script>
    `);

    const steps: WebTestStep[] = [
      { action: 'type', selector: '#name', value: 'Patrice' },
      { action: 'click', selector: '#go' },
    ];
    const result = await webTest.execute({
      url: pages.url,
      steps,
      assertions: [
        { type: 'text', value: 'Bonjour Patrice' },
        { type: 'selector', value: '#out' },
      ],
      screenshot: false,
    });

    expect(result.success, result.error).toBe(true);
    expect((result.data as { passed: boolean }).passed).toBe(true);
    expect(result.output).toContain('PASSED');
    // The two interactions rendered as OK checks, in order…
    expect(result.output).toContain('✓ step 1 type "Patrice" into "#name": ok');
    expect(result.output).toContain('✓ step 2 click "#go": ok');
    // …and the flow's result was then verified.
    expect(result.output).toContain('✓ assert text "Bonjour Patrice"');
    expect(result.output).toContain('✓ assert selector "#out"');
  });

  it('fails the run when a step selector does not exist, with clear evidence', async () => {
    pages = await serveTestPages(`<!doctype html>
      <title>Greeter</title>
      <input id="name" />
      <button id="go">Go</button>
    `);

    const result = await webTest.execute({
      url: pages.url,
      steps: [{ action: 'click', selector: '#does-not-exist' }],
      screenshot: false,
    });

    expect(result.success, result.error).toBe(true);
    expect((result.data as { passed: boolean }).passed).toBe(false);
    expect(result.output).toContain('FAILED');
    expect(result.output).toContain('✗ step 1 click "#does-not-exist"');
    expect(result.output).toContain('NOT found');
    // The failing check is in the structured data too.
    const checks = (result.data as { checks: Array<{ name: string; passed: boolean }> }).checks;
    const stepCheck = checks.find((c) => c.name.startsWith('step 1 click'));
    expect(stepCheck?.passed).toBe(false);
  });

  it('bonus: a click that fires a broken fetch (500) is caught by the network oracle after the step', async () => {
    // A page that renders perfectly; only a button click triggers a failing API.
    const server = http.createServer((q, s) => {
      if (q.url === '/api/broken') {
        s.statusCode = 500;
        s.setHeader('Content-Type', 'application/json');
        s.end('{"error":"boom"}');
        return;
      }
      s.setHeader('Content-Type', 'text/html; charset=utf-8');
      s.end(`<!doctype html>
        <title>Dash</title>
        <h1>Dashboard</h1>
        <button id="load">Load</button>
        <script>
          document.getElementById('load').addEventListener('click', () => {
            fetch('/api/broken').catch(() => {});
          });
        </script>`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const reg = (await import('../../src/security/dev-origins.js')).registerDevOrigin(base);
    expect(reg.ok, reg.error).toBe(true);

    try {
      const result = await webTest.execute({
        url: `${base}/`,
        // Click fires the fetch, wait lets the 500 land before the oracles read.
        steps: [
          { action: 'click', selector: '#load' },
          { action: 'wait', ms: 800 },
        ],
        // console allowed — a failed fetch also logs a console error; isolate the
        // NETWORK oracle as the thing that fails the run.
        assertions: [{ type: 'text', value: 'Dashboard' }],
        allowConsoleErrors: true,
        screenshot: false,
      });

      expect(result.success, result.error).toBe(true);
      const data = result.data as { passed: boolean; networkFailureCount: number };
      // The step ran and the UI text is present…
      expect(result.output).toContain('✓ step 1 click "#load": ok');
      expect(result.output).toContain('✓ assert text "Dashboard"');
      // …yet the run FAILED purely on the network oracle catching the click's fetch.
      expect(data.passed).toBe(false);
      expect(data.networkFailureCount).toBeGreaterThan(0);
      expect(result.output).toContain('✗ network');
      expect(result.output).toContain('/api/broken');
      expect(result.output).toContain('500');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
