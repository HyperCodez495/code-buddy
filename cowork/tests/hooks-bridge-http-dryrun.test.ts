/**
 * Tests for the HTTP dry-run path in `hooks-bridge.ts:test()`.
 * We stub `globalThis.fetch` so the test does not hit the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HooksBridge, type UserHookHandler } from '../src/main/hooks/hooks-bridge';

const mkBridge = () => {
  const b = new HooksBridge();
  // The bridge uses `workspaceDir` for command execution; HTTP doesn't
  // need it but seeding helps if the implementation later reads it.
  (b as unknown as { workspaceDir: string }).workspaceDir = '/tmp';
  return b;
};

describe('HooksBridge / HTTP dry-run', () => {
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('reports success on 200 with the response body in stdout', async () => {
    const fetchMock = vi.fn(async (_url, init: RequestInit) => {
      // Validate the dry-run header is present.
      const headers = init.headers as Record<string, string>;
      expect(headers['x-codebuddy-hook-dryrun']).toBe('1');
      expect(init.method).toBe('POST');
      const parsed = JSON.parse(init.body as string);
      expect(parsed.dryRun).toBe(true);
      return new Response('ok', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const handler: UserHookHandler = {
      type: 'http',
      url: 'http://127.0.0.1:9999/hook',
      timeout: 5000,
    };
    const result = await mkBridge().test(handler);
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(200);
    expect(result.stdout).toBe('ok');
    expect(result.error).toBeUndefined();
  });

  it('reports failure on 404, status code in exitCode', async () => {
    globalThis.fetch = (async () =>
      new Response('not found', {
        status: 404,
        headers: { 'content-type': 'text/plain' },
      })) as typeof globalThis.fetch;

    const handler: UserHookHandler = {
      type: 'http',
      url: 'http://127.0.0.1:9999/missing',
    };
    const result = await mkBridge().test(handler);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(404);
    expect(result.stdout).toBe('not found');
  });

  it('reports timeout when fetch is slow', async () => {
    // Mock fetch to sleep longer than the timeout. We use a real timer
    // since the abort behaviour relies on AbortController + setTimeout.
    globalThis.fetch = (async (_url, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      return await new Promise<Response>((resolve, reject) => {
        const t = setTimeout(() => resolve(new Response('late')), 5000);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }) as typeof globalThis.fetch;

    const handler: UserHookHandler = {
      type: 'http',
      url: 'http://127.0.0.1:9999/slow',
      timeout: 100,
    };
    const result = await mkBridge().test(handler);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(result.error).toMatch(/Timed out/);
  });

  it('rejects an invalid URL up front', async () => {
    const handler: UserHookHandler = {
      type: 'http',
      url: 'not-a-url',
    };
    const result = await mkBridge().test(handler);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid HTTP url/);
  });

  it('forwards user-provided custom headers', async () => {
    let capturedHeaders: Record<string, string> | null = null;
    globalThis.fetch = (async (_url, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return new Response('', { status: 200 });
    }) as typeof globalThis.fetch;

    const handler: UserHookHandler = {
      type: 'http',
      url: 'http://127.0.0.1:9999/auth',
      headers: { authorization: 'Bearer xyz' },
    };
    await mkBridge().test(handler);
    expect(capturedHeaders!['authorization']).toBe('Bearer xyz');
    // Built-in header still present.
    expect(capturedHeaders!['x-codebuddy-hook-dryrun']).toBe('1');
  });
});
