/**
 * app_server — real process lifecycle round-trips (no mocks): every test
 * spawns a real child process (node one-liners) and exercises readiness,
 * dev-origin registration, refusal to adopt pre-existing services, timeout
 * kill, logs, and teardown.
 */
import http from 'http';
import net from 'net';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppServerTool } from '../../src/tools/app-server-tool.js';
import { isDevOriginAllowed, resetDevOrigins } from '../../src/security/dev-origins.js';
import { resetProcessTool } from '../../src/tools/process-tool.js';

vi.setConfig({ testTimeout: 30_000 });

/** A definitely-free loopback port (listen on 0, close, reuse the number). */
async function freePort(): Promise<number> {
  return await new Promise<number>((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

function serverCommand(port: number): string {
  const js = `require("http").createServer((q,s)=>{console.log("hit "+q.url);s.end("ok")}).listen(${port},"127.0.0.1",()=>console.log("listening"))`;
  return `node -e '${js}'`;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('AppServerTool (real processes)', () => {
  let tool: AppServerTool;

  afterEach(async () => {
    await tool?.stopAll();
    resetDevOrigins();
    resetProcessTool();
  });

  it('start → ready → origin browsable → stop → origin closed, process dead', async () => {
    tool = new AppServerTool();
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;

    const started = await tool.start({ command: serverCommand(port), url, timeoutMs: 15_000 });
    expect(started.success, started.error).toBe(true);
    expect(started.output).toContain('Dev server ready');

    const { pid, origin } = started.data as { pid: number; origin: string };
    expect(isAlive(pid)).toBe(true);
    expect(origin).toBe(`http://127.0.0.1:${port}`);
    expect(isDevOriginAllowed(`${url}some/route`)).toBe(true);

    // Server-side logs are readable (the Manus shell_view pattern).
    await fetch(url);
    await new Promise((r) => setTimeout(r, 200));
    const logs = await tool.logs(pid);
    expect(logs.success, logs.error).toBe(true);
    expect(logs.output).toContain('listening');

    const status = await tool.status();
    expect(status.output).toContain(`pid ${pid}`);
    expect(status.output).toContain('running');

    const stopped = await tool.stop(pid);
    expect(stopped.success, stopped.error).toBe(true);
    expect(isDevOriginAllowed(url)).toBe(false);
    // SIGTERM + grace: the node one-liner dies immediately.
    expect(isAlive(pid)).toBe(false);
  });

  it('refuses to adopt a pre-existing service on the port', async () => {
    tool = new AppServerTool();
    const existing = http.createServer((_q, s) => s.end('pre-existing'));
    await new Promise<void>((resolve) => existing.listen(0, '127.0.0.1', resolve));
    const port = (existing.address() as AddressInfo).port;

    try {
      const result = await tool.start({ command: serverCommand(port + 1), url: `http://127.0.0.1:${port}/` });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already in use');
      expect(isDevOriginAllowed(`http://127.0.0.1:${port}/`)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => existing.close(() => resolve()));
    }
  });

  it('kills the process and registers nothing when readiness times out', async () => {
    tool = new AppServerTool();
    const port = await freePort();
    // A process that runs but never listens.
    const result = await tool.start({
      command: `node -e 'console.error("not a server");setInterval(()=>{},1000)'`,
      url: `http://127.0.0.1:${port}/`,
      timeoutMs: 2_000,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('did not answer');
    expect(result.error).toContain('not a server');
    expect(isDevOriginAllowed(`http://127.0.0.1:${port}/`)).toBe(false);

    const status = await tool.status();
    expect(status.output).not.toContain('running,');
  });

  it('fails fast with the log tail when the command exits immediately', async () => {
    tool = new AppServerTool();
    const port = await freePort();
    const result = await tool.start({
      command: `node -e 'console.error("boom: missing module");process.exit(1)'`,
      url: `http://127.0.0.1:${port}/`,
      timeoutMs: 10_000,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('exited before becoming ready');
    expect(result.error).toContain('boom: missing module');
    expect(isDevOriginAllowed(`http://127.0.0.1:${port}/`)).toBe(false);
  });

  it('rejects non-loopback readiness URLs outright', async () => {
    tool = new AppServerTool();
    const result = await tool.start({ command: 'node -e ""', url: 'http://192.168.1.20:3000/' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('loopback');
  });
});
