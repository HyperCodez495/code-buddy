import { FetchTool } from '../../src/tools/fetch-tool.js';
import { ImageTool } from '../../src/tools/image-tool.js';
import { WebSearchTool, setWebSearchMode } from '../../src/tools/web-search.js';
import { getSSRFGuard, resetSSRFGuard } from '../../src/security/ssrf-guard.js';
import { safeFetchFollow } from '../../src/security/safe-fetch.js';

describe('SSRF-safe redirect handling', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetSSRFGuard();
    getSSRFGuard({
      allowedHosts: ['public.example', 'cdn.example'],
      resolveDns: false,
    });
    setWebSearchMode('live');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    resetSSRFGuard();
  });

  it('refuses a redirect to cloud metadata before following it', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
    }));
    global.fetch = fetchMock;

    const result = await new FetchTool().execute({ url: 'https://public.example/start' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('SSRF guard');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows a legitimate same-origin redirect and keeps authorization', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { Location: '/final' },
      }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    global.fetch = fetchMock;

    const response = await safeFetchFollow('https://public.example/start', {
      headers: { Authorization: 'Bearer legitimate-token' },
    });

    expect(await response.text()).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://public.example/final');
    const redirectedHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(redirectedHeaders.get('authorization')).toBe('Bearer legitimate-token');
  });

  it('strips authorization on a legitimate cross-origin redirect', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { Location: 'https://cdn.example/final' },
      }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    global.fetch = fetchMock;

    await safeFetchFollow('https://public.example/start', {
      headers: { Authorization: 'Bearer must-not-leak' },
    });

    const redirectedHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(redirectedHeaders.has('authorization')).toBe(false);
  });

  it('protects image URL downloads from unsafe redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { Location: 'http://169.254.169.254/image.png' },
    }));
    global.fetch = fetchMock;

    const result = await new ImageTool().processImage({
      type: 'url',
      data: 'https://public.example/image.png',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('SSRF guard');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('protects fetched search result pages from unsafe redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { Location: 'http://169.254.169.254/page' },
    }));
    global.fetch = fetchMock;

    const result = await new WebSearchTool().fetchPage('https://public.example/page');

    expect(result.success).toBe(false);
    expect(result.error).toContain('SSRF guard');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
