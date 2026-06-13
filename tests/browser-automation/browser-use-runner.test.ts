import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { executeBrowserUseAction } from '../../src/browser-automation/browser-use-runner.js';

describe('browser-use-runner', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // Clear relevant env vars to avoid test pollution.
    delete process.env.BROWSER_USE_API_KEY;
    delete process.env.CODEBUDDY_NOUS_TOOL_GATEWAY_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  // -----------------------------------------------------------------------
  // No configuration
  // -----------------------------------------------------------------------

  it('returns an error when neither API key nor gateway is configured', async () => {
    const result = await executeBrowserUseAction('click button', 'https://example.com');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured/i);
  });

  // -----------------------------------------------------------------------
  // Browser Use API (API key)
  // -----------------------------------------------------------------------

  describe('Browser Use API', () => {
    it('sends a request with the API key and returns content', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ result: 'Heading: Hello World' }),
      });

      const result = await executeBrowserUseAction(
        'Extract the heading',
        'https://example.com',
        { apiKey: 'test-key-123' },
      );

      expect(result.ok).toBe(true);
      expect(result.content).toBe('Heading: Hello World');

      // Verify the fetch call.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.browser-use.com/api/v1/run-task');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key-123');
    });

    it('reads the API key from env when not explicitly provided', async () => {
      process.env.BROWSER_USE_API_KEY = 'env-key-456';
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ content: 'from env' }),
      });

      const result = await executeBrowserUseAction('do something', 'https://example.com');

      expect(result.ok).toBe(true);
      expect(result.content).toBe('from env');
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer env-key-456');
    });

    it('returns screenshot data when present', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          result: 'Page loaded',
          screenshot: 'iVBORw0KGgo=',
        }),
      });

      const result = await executeBrowserUseAction('take screenshot', 'https://example.com', {
        apiKey: 'key',
      });

      expect(result.ok).toBe(true);
      expect(result.screenshot).toBe('iVBORw0KGgo=');
    });

    it('handles HTTP error responses', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const result = await executeBrowserUseAction('click', 'https://example.com', {
        apiKey: 'bad-key',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/401/);
      expect(result.error).toMatch(/Unauthorized/);
    });

    it('handles network errors', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await executeBrowserUseAction('click', 'https://example.com', {
        apiKey: 'key',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/ECONNREFUSED/);
    });

    it('handles abort/timeout errors', async () => {
      const abortError = new DOMException('The operation was aborted.', 'AbortError');
      fetchMock.mockRejectedValue(abortError);

      const result = await executeBrowserUseAction('click', 'https://example.com', {
        apiKey: 'key',
        timeout: 100,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/timed out/i);
    });
  });

  // -----------------------------------------------------------------------
  // Nous Tool Gateway
  // -----------------------------------------------------------------------

  describe('Nous Tool Gateway', () => {
    it('routes through the gateway when only gateway URL is set', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ output: 'Gateway result' }),
      });

      const result = await executeBrowserUseAction(
        'Navigate and extract',
        'https://example.com',
        { gatewayUrl: 'http://localhost:8080/tools' },
      );

      expect(result.ok).toBe(true);
      expect(result.content).toBe('Gateway result');

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:8080/tools/browser-use');
    });

    it('reads gateway URL from env', async () => {
      process.env.CODEBUDDY_NOUS_TOOL_GATEWAY_URL = 'http://gateway.local:9090/';
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ text: 'env gateway' }),
      });

      const result = await executeBrowserUseAction('test', 'https://example.com');

      expect(result.ok).toBe(true);
      expect(result.content).toBe('env gateway');
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      // Trailing slash should be stripped.
      expect(url).toBe('http://gateway.local:9090/browser-use');
    });

    it('prefers API key over gateway URL when both are set', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ result: 'api wins' }),
      });

      const result = await executeBrowserUseAction(
        'test',
        'https://example.com',
        { apiKey: 'api-key', gatewayUrl: 'http://gateway.local/' },
      );

      expect(result.ok).toBe(true);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      // Should use the Browser Use API, not the gateway.
      expect(url).toBe('https://api.browser-use.com/api/v1/run-task');
    });

    it('handles gateway HTTP errors', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => 'Bad Gateway',
      });

      const result = await executeBrowserUseAction('click', 'https://example.com', {
        gatewayUrl: 'http://gateway.local/',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/502/);
    });
  });

  // -----------------------------------------------------------------------
  // Response normalisation
  // -----------------------------------------------------------------------

  describe('response normalisation', () => {
    it('prefers "result" over "content" over "output" over "text"', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ result: 'R', content: 'C', output: 'O', text: 'T' }),
      });

      const result = await executeBrowserUseAction('test', 'https://example.com', {
        apiKey: 'key',
      });
      expect(result.content).toBe('R');
    });

    it('falls back to JSON.stringify for unknown shapes', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { nested: true } }),
      });

      const result = await executeBrowserUseAction('test', 'https://example.com', {
        apiKey: 'key',
      });
      expect(result.content).toContain('"nested":true');
    });
  });
});
