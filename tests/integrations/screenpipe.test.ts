import { describe, it, expect } from 'vitest';
import { ScreenpipeClient } from '../../src/integrations/screenpipe/screenpipe-client.js';
import { ScreenMemoryTool } from '../../src/tools/registry/screenpipe-tools.js';

function fakeFetch(handler: (url: string) => { ok: boolean; status?: number; body?: unknown }) {
  return async (url: string) => {
    const r = handler(url);
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
