import { describe, it, expect } from 'vitest';
import { ScreenpipeClient } from '../../src/integrations/screenpipe/screenpipe-client.js';
import { ScreenMemoryTool } from '../../src/tools/registry/screenpipe-tools.js';

function fakeFetch(
  handler: (
    url: string,
    init?: { method?: string; headers?: Record<string, string> },
  ) => { ok: boolean; status?: number; body?: unknown },
) {
  return async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
    const r = handler(url, init);
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body ?? {} };
  };
}

describe('ScreenpipeClient', () => {
  it('builds the /search query and normalizes snake_case results', async () => {
    let seen = '';
    const client = new ScreenpipeClient({
      baseUrl: 'http://localhost:3030',
      fetchImpl: fakeFetch((url) => {
        seen = url;
        return {
          ok: true,
          body: {
            data: [
              { type: 'OCR', content: { text: 'a build error', timestamp: '2026-06-09T08:00:00Z', app_name: 'kitty', window_name: 'vim', file_path: '/f.png' } },
            ],
            pagination: { total: 1 },
          },
        };
      }),
    });
    const res = await client.search({ query: 'error', contentType: 'ocr', limit: 5, appName: 'kitty' });
    expect(seen).toContain('/search?');
    expect(seen).toContain('content_type=ocr');
    expect(seen).toContain('q=error');
    expect(seen).toContain('limit=5');
    expect(seen).toContain('app_name=kitty');
    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ type: 'OCR', text: 'a build error', appName: 'kitty', windowName: 'vim' });
  });

  it('health() is true on 200, false on error', async () => {
    expect(await new ScreenpipeClient({ fetchImpl: fakeFetch(() => ({ ok: true })) }).health()).toBe(true);
    expect(
      await new ScreenpipeClient({
        fetchImpl: (async () => {
          throw new Error('ECONNREFUSED');
        }) as never,
      }).health(),
    ).toBe(false);
  });

  it('respects SCREENPIPE_URL / explicit baseUrl and strips trailing slash', () => {
    expect(new ScreenpipeClient({ baseUrl: 'http://host:9999/' }).baseUrl).toBe('http://host:9999');
  });

  it('attaches Authorization: Bearer when an explicit apiKey is set (search + health)', async () => {
    let searchHeaders: Record<string, string> | undefined;
    let healthHeaders: Record<string, string> | undefined;
    const client = new ScreenpipeClient({
      apiKey: 'tok-123',
      fetchImpl: fakeFetch((url, init) => {
        if (url.includes('/search')) searchHeaders = init?.headers;
        if (url.includes('/health')) healthHeaders = init?.headers;
        return { ok: true, body: { data: [], pagination: { total: 0 } } };
      }),
    });
    await client.search({ query: 'x' });
    await client.health();
    expect(searchHeaders?.['Authorization']).toBe('Bearer tok-123');
    expect(healthHeaders?.['Authorization']).toBe('Bearer tok-123');
  });

  it('reads the apiKey from SCREENPIPE_API_KEY when not passed explicitly', async () => {
    const prev = process.env['SCREENPIPE_API_KEY'];
    process.env['SCREENPIPE_API_KEY'] = 'env-tok';
    try {
      let seen: Record<string, string> | undefined;
      const client = new ScreenpipeClient({
        fetchImpl: fakeFetch((_url, init) => {
          seen = init?.headers;
          return { ok: true, body: { data: [], pagination: { total: 0 } } };
        }),
      });
      await client.search({ query: 'x' });
      expect(seen?.['Authorization']).toBe('Bearer env-tok');
    } finally {
      if (prev === undefined) delete process.env['SCREENPIPE_API_KEY'];
      else process.env['SCREENPIPE_API_KEY'] = prev;
    }
  });

  it('sends NO Authorization header when no apiKey/SCREENPIPE_API_KEY is set', async () => {
    const prev = process.env['SCREENPIPE_API_KEY'];
    delete process.env['SCREENPIPE_API_KEY'];
    try {
      let searchHeaders: Record<string, string> | undefined;
      let healthHeaders: Record<string, string> | undefined;
      let sawSearchInit = false;
      let sawHealthInit = false;
      const client = new ScreenpipeClient({
        fetchImpl: fakeFetch((url, init) => {
          if (url.includes('/search')) {
            sawSearchInit = true;
            searchHeaders = init?.headers;
          }
          if (url.includes('/health')) {
            sawHealthInit = true;
            healthHeaders = init?.headers;
          }
          return { ok: true, body: { data: [], pagination: { total: 0 } } };
        }),
      });
      await client.search({ query: 'x' });
      await client.health();
      expect(sawSearchInit).toBe(true);
      expect(sawHealthInit).toBe(true);
      // No headers object at all, or one without Authorization.
      expect(searchHeaders?.['Authorization']).toBeUndefined();
      expect(healthHeaders?.['Authorization']).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env['SCREENPIPE_API_KEY'];
      else process.env['SCREENPIPE_API_KEY'] = prev;
    }
  });
});

function fakeClient(over: Partial<{ healthy: boolean; items: unknown[]; total: number }> = {}) {
  return {
    baseUrl: 'http://localhost:3030',
    health: async () => over.healthy ?? true,
    search: async () => ({ items: over.items ?? [], total: over.total ?? 0 }),
  } as unknown as ScreenpipeClient;
}

describe('ScreenMemoryTool', () => {
  it('errors with guidance when screenpipe is unreachable', async () => {
    const tool = new ScreenMemoryTool(() => fakeClient({ healthy: false }));
    const r = await tool.execute({ query: 'x' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not reachable|screenpipe/i);
  });

  it('formats results and redacts secrets from text', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const tool = new ScreenMemoryTool(() =>
      fakeClient({
        healthy: true,
        total: 1,
        items: [{ type: 'OCR', text: `token ${jwt} shown`, appName: 'kitty', windowName: 'vim', timestamp: 't' }],
      }),
    );
    const r = await tool.execute({ query: 'token' });
    expect(r.success).toBe(true);
    expect(r.output).toContain('[OCR]');
    expect(r.output).toContain('kitty › vim');
    expect(r.output).toContain('[REDACTED:'); // secret stripped
    expect(r.output).not.toContain(jwt);
  });

  it('reports no results cleanly', async () => {
    const tool = new ScreenMemoryTool(() => fakeClient({ healthy: true, items: [], total: 0 }));
    const r = await tool.execute({ query: 'nothing' });
    expect(r.success).toBe(true);
    expect(r.output).toMatch(/No screen memory/i);
  });
});
