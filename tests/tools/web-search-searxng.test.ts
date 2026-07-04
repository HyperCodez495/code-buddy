/**
 * SearXNG search provider — additive, opt-in via `SEARXNG_URL`.
 *
 * All HTTP is injected (no real network):
 *  - the SearXNG provider routes through the injectable `httpGet` boundary;
 *  - the DuckDuckGo fallback goes through the module-mocked `axios.get`.
 *
 * Coverage:
 *  - JSON `results[]` → SearchResult mapping (structured + formatted text);
 *  - request shape (`/search`, `format=json`, `categories=general`, `q=…`);
 *  - preference: SearXNG is FIRST in the chain when `SEARXNG_URL` is set;
 *  - fallback: SearXNG error / invalid JSON / 0 results → next provider, never throws;
 *  - byte-identical chain when `SEARXNG_URL` is absent (SearXNG never attempted);
 *  - malformed / non-http(s) `SEARXNG_URL` disables the provider (never crash);
 *  - 15-min cache reuse on the SearXNG path.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = axios as unknown as { get: Mock; post: Mock };

import { WebSearchTool, type WebSearchHttpGet } from '../../src/tools/web-search.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SEARXNG_JSON = {
  query: 'rust async runtime',
  number_of_results: 3,
  results: [
    {
      url: 'https://tokio.rs',
      title: 'Tokio — asynchronous Rust',
      content: 'An asynchronous runtime for Rust.',
      engine: 'google',
      publishedDate: '2026-05-01',
    },
    {
      url: 'https://async.rs',
      title: 'async-std',
      content: 'Async version of the Rust standard library.',
      engine: 'duckduckgo',
    },
    {
      url: 'https://smol.rs',
      title: 'smol',
      content: 'A small and fast async runtime.',
      engine: 'bing',
    },
  ],
};

// DuckDuckGo HTML fixture — same shape the existing DDG parser expects.
const DDG_HTML = `
  <div class="result">
    <a class="result__a" href="https://ddg-fallback.example/page">DDG Fallback Result</a>
    <a class="result__snippet">Came from DuckDuckGo</a>
  </div></div>
`;

/** Read the private provider chain without an `any` cast. */
type ChainProbe = { buildProviderChain(): string[] };
function chainOf(tool: WebSearchTool): string[] {
  return (tool as unknown as ChainProbe).buildProviderChain();
}

// ---------------------------------------------------------------------------
// Env isolation (SEARXNG_URL + provider keys are read at construction time)
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  'SEARXNG_URL',
  'BRAVE_API_KEY',
  'SERPER_API_KEY',
  'PERPLEXITY_API_KEY',
  'OPENROUTER_API_KEY',
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  vi.clearAllMocks();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// ---------------------------------------------------------------------------
// Mapping — SearXNG JSON → results (structured + text)
// ---------------------------------------------------------------------------

describe('SearXNG provider — JSON mapping', () => {
  it('maps results[] to structured SearchResult[] (top-K, title/url/snippet)', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8888';
    const httpGet = vi.fn(async (_url: string, _config?: AxiosRequestConfig) => ({ data: SEARXNG_JSON }));
    const tool = new WebSearchTool({ httpGet: httpGet as unknown as WebSearchHttpGet });

    const hits = await tool.searchStructured('rust async runtime');

    expect(hits).toHaveLength(3);
    expect(hits[0]).toMatchObject({
      title: 'Tokio — asynchronous Rust',
      url: 'https://tokio.rs',
      snippet: 'An asynchronous runtime for Rust.',
      siteName: 'tokio.rs',
    });
    expect(hits[1]?.url).toBe('https://async.rs');
    expect(hits[2]?.url).toBe('https://smol.rs');
  });

  it('honors maxResults as top-K on the structured path', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8888';
    const httpGet = vi.fn(async (_url: string, _config?: AxiosRequestConfig) => ({ data: SEARXNG_JSON }));
    const tool = new WebSearchTool({ httpGet: httpGet as unknown as WebSearchHttpGet });

    const hits = await tool.searchStructured('rust async runtime', { maxResults: 2 });
    expect(hits).toHaveLength(2);
  });

  it('formats the text output with the header and a Sources block', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8888';
    const httpGet = vi.fn(async (_url: string, _config?: AxiosRequestConfig) => ({ data: SEARXNG_JSON }));
    const tool = new WebSearchTool({ httpGet: httpGet as unknown as WebSearchHttpGet });

    const res = await tool.search('rust async runtime');

    expect(res.success).toBe(true);
    expect(res.output).toContain('🔍 Résultats pour: "rust async runtime"');
    expect(res.output).toContain('Tokio — asynchronous Rust');
    expect(res.output).toContain('https://tokio.rs');
    expect(res.output).toContain('**Sources:**');
    expect(res.output).toContain('[1] Tokio — asynchronous Rust — https://tokio.rs');
  });

  it('builds the JSON search request (/search, format=json, categories=general, q=…)', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8888/';
    const httpGet = vi.fn(async (_url: string, _config?: AxiosRequestConfig) => ({ data: SEARXNG_JSON }));
    const tool = new WebSearchTool({ httpGet: httpGet as unknown as WebSearchHttpGet });

    await tool.searchStructured('rust async runtime', { search_lang: 'fr' });

    expect(httpGet).toHaveBeenCalledTimes(1);
    // Trailing slash on SEARXNG_URL is normalized (no double slash).
    expect(httpGet).toHaveBeenCalledWith(expect.stringContaining('http://localhost:8888/search'), expect.anything());
    expect(httpGet).toHaveBeenCalledWith(expect.stringContaining('format=json'), expect.anything());
    expect(httpGet).toHaveBeenCalledWith(expect.stringContaining('categories=general'), expect.anything());
    expect(httpGet).toHaveBeenCalledWith(expect.stringContaining('q=rust+async+runtime'), expect.anything());
    expect(httpGet).toHaveBeenCalledWith(expect.stringContaining('language=fr'), expect.anything());
    // Bounded timeout on the request.
    expect(httpGet).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 20000 }));
  });

  it('caches the SearXNG result (15-min TTL) — second search() does not re-query', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8888';
    const httpGet = vi.fn(async (_url: string, _config?: AxiosRequestConfig) => ({ data: SEARXNG_JSON }));
    const tool = new WebSearchTool({ httpGet: httpGet as unknown as WebSearchHttpGet });

    await tool.search('rust async runtime');
    await tool.search('rust async runtime');
    expect(httpGet).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Preference — SearXNG first when configured
// ---------------------------------------------------------------------------

describe('SearXNG provider — preference in the chain', () => {
  it('is FIRST in the chain when SEARXNG_URL is set', () => {
    process.env.SEARXNG_URL = 'http://localhost:8888';
    const tool = new WebSearchTool({ httpGet: vi.fn() as unknown as WebSearchHttpGet });
    const chain = chainOf(tool);
    expect(chain[0]).toBe('searxng');
    expect(chain).toEqual(['searxng', 'brave-mcp', 'duckduckgo']);
  });

  it('accepts an instance with a base path (…/searxng/search)', async () => {
    process.env.SEARXNG_URL = 'https://search.example.org/searxng';
    const httpGet = vi.fn(async (_url: string, _config?: AxiosRequestConfig) => ({ data: SEARXNG_JSON }));
    const tool = new WebSearchTool({ httpGet: httpGet as unknown as WebSearchHttpGet });

    await tool.searchStructured('rust async runtime');
    expect(httpGet).toHaveBeenCalledWith(
      expect.stringContaining('https://search.example.org/searxng/search'),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// Fallback / never-throws
// ---------------------------------------------------------------------------

describe('SearXNG provider — degradation falls through to the next provider', () => {
  it('SearXNG transport error → DuckDuckGo, never throws (text path)', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8888';
    const httpGet = vi.fn(async (_url: string, _config?: AxiosRequestConfig): Promise<{ data: unknown }> => {
      throw new Error('ECONNREFUSED — SearXNG down');
    });
    mockedAxios.get.mockResolvedValue({ data: DDG_HTML });
    const tool = new WebSearchTool({ httpGet: httpGet as unknown as WebSearchHttpGet });

    const res = await tool.search('anything');

    expect(res.success).toBe(true);
    expect(httpGet).toHaveBeenCalled(); // SearXNG WAS attempted first
    expect(res.output).toContain('DDG Fallback Result'); // then fell through to DuckDuckGo
  });

  it('SearXNG transport error → next provider (structured path)', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8888';
    const httpGet = vi.fn(async (_url: string, _config?: AxiosRequestConfig): Promise<{ data: unknown }> => {
      throw new Error('timeout of 20000ms exceeded');
    });
    mockedAxios.get.mockResolvedValue({ data: DDG_HTML });
    const tool = new WebSearchTool({ httpGet: httpGet as unknown as WebSearchHttpGet });

    const hits = await tool.searchStructured('anything');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.url).toContain('ddg-fallback');
  });

  it('invalid JSON (HTML error page) → 0 results → next provider', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8888';
    const httpGet = vi.fn(async (_url: string, _config?: AxiosRequestConfig) => ({ data: '<html>502 Bad Gateway</html>' }));
    mockedAxios.get.mockResolvedValue({ data: DDG_HTML });
    const tool = new WebSearchTool({ httpGet: httpGet as unknown as WebSearchHttpGet });

    const res = await tool.search('anything');
    expect(res.success).toBe(true);
    expect(res.output).toContain('DDG Fallback Result');
  });

  it('empty results array → next provider', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8888';
    const httpGet = vi.fn(async (_url: string, _config?: AxiosRequestConfig) => ({ data: { results: [] } }));
    mockedAxios.get.mockResolvedValue({ data: DDG_HTML });
    const tool = new WebSearchTool({ httpGet: httpGet as unknown as WebSearchHttpGet });

    const hits = await tool.searchStructured('anything');
    expect(hits[0]?.url).toContain('ddg-fallback');
  });

  it('forcing provider:searxng while unconfigured returns an error, never crashes', async () => {
    // SEARXNG_URL intentionally unset.
    const httpGet = vi.fn();
    const tool = new WebSearchTool({ httpGet: httpGet as unknown as WebSearchHttpGet });

    const res = await tool.search('anything', { provider: 'searxng' });
    expect(res.success).toBe(false);
    expect(httpGet).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Byte-identical chain when SEARXNG_URL is absent
// ---------------------------------------------------------------------------

describe('SEARXNG_URL absent — chain is unchanged, SearXNG never attempted', () => {
  it('does not include searxng in the chain', () => {
    const tool = new WebSearchTool({ httpGet: vi.fn() as unknown as WebSearchHttpGet });
    expect(chainOf(tool)).toEqual(['brave-mcp', 'duckduckgo']);
  });

  it('preserves the historical order with all keys present', () => {
    process.env.BRAVE_API_KEY = 'k';
    process.env.PERPLEXITY_API_KEY = 'k';
    process.env.SERPER_API_KEY = 'k';
    const tool = new WebSearchTool({ httpGet: vi.fn() as unknown as WebSearchHttpGet });
    expect(chainOf(tool)).toEqual(['brave-mcp', 'brave', 'perplexity', 'serper', 'duckduckgo']);
  });

  it('never calls the SearXNG boundary during a real search', async () => {
    const httpGet = vi.fn(async (_url: string, _config?: AxiosRequestConfig) => ({ data: SEARXNG_JSON }));
    mockedAxios.get.mockResolvedValue({ data: DDG_HTML });
    const tool = new WebSearchTool({ httpGet: httpGet as unknown as WebSearchHttpGet });

    const res = await tool.search('anything');

    expect(res.success).toBe(true);
    expect(res.output).toContain('DDG Fallback Result');
    expect(httpGet).not.toHaveBeenCalled(); // proof: SearXNG was never tried
  });
});

// ---------------------------------------------------------------------------
// Malformed / non-http(s) SEARXNG_URL is rejected
// ---------------------------------------------------------------------------

describe('SEARXNG_URL validation — malformed values disable the provider', () => {
  it.each([
    ['garbage', 'not a url at all'],
    ['ftp scheme', 'ftp://localhost:8888'],
    ['file scheme', 'file:///etc/passwd'],
    ['empty', '   '],
  ])('rejects %s and keeps SearXNG out of the chain', async (_label, value) => {
    process.env.SEARXNG_URL = value;
    const httpGet = vi.fn(async (_url: string, _config?: AxiosRequestConfig) => ({ data: SEARXNG_JSON }));
    mockedAxios.get.mockResolvedValue({ data: DDG_HTML });
    const tool = new WebSearchTool({ httpGet: httpGet as unknown as WebSearchHttpGet });

    expect(chainOf(tool)).not.toContain('searxng');

    const res = await tool.search('anything');
    expect(res.success).toBe(true);
    expect(httpGet).not.toHaveBeenCalled(); // SearXNG disabled → never attempted
  });
});
