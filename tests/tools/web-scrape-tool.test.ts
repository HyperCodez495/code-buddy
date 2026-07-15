import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebScrapeTool } from '../../src/tools/web-scrape-tool.js';

interface FakeSpawnOptions {
  stdout?: string;
  stderr?: string;
  code?: number;
  error?: NodeJS.ErrnoException;
  neverClose?: boolean;
}

function fakeSpawn(options: FakeSpawnOptions = {}) {
  return vi.fn(((_command: string, _args: string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: EventEmitter & { end: (value: string) => void };
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
    child.kill = vi.fn();
    if (!options.neverClose) {
      setImmediate(() => {
        if (options.stdout) child.stdout.emit('data', Buffer.from(options.stdout));
        if (options.stderr) child.stderr.emit('data', Buffer.from(options.stderr));
        if (options.error) child.emit('error', options.error);
        else child.emit('close', options.code ?? 0, null);
      });
    }
    return child;
  }) as never);
}

const SAFE_URL = 'https://example.com/article';
const safeCheck = async () => ({ safe: true });

describe('WebScrapeTool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns Markdown and the HTTP engine from the sidecar', async () => {
    const spawn = fakeSpawn({
      stdout: '{"ok":true,"status":200,"engine":"http","markdown":"# Fast page"}\n',
    });
    const result = await new WebScrapeTool({ spawn, checkUrl: safeCheck }).execute({ url: SAFE_URL });

    expect(result.success).toBe(true);
    expect(result.output).toContain('# Fast page');
    expect(result.output).toContain('Engine: http');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('includes named CSS selector results in the readable output', async () => {
    const spawn = fakeSpawn({
      stdout: '{"ok":true,"status":200,"engine":"http","markdown":"Page","extracted":{"prices":["10 €","12 €"]}}\n',
    });
    const result = await new WebScrapeTool({ spawn, checkUrl: safeCheck }).execute({
      url: SAFE_URL,
      css: { prices: '.price' },
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Extracted:');
    expect(result.output).toContain('10 €');
    expect(result.output).toContain('prices');
  });

  it('falls back to a mocked web_fetch when Scrapling is not installed', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ success: true, output: 'Lightweight content' });
    const result = await new WebScrapeTool({
      checkUrl: safeCheck,
      runScrapling: async () => ({ ok: false, error: 'scrapling-not-installed' }),
      fetchPage,
    }).execute({ url: SAFE_URL });

    expect(result.success).toBe(true);
    expect(fetchPage).toHaveBeenCalledWith(SAFE_URL);
    expect(result.output).toContain('fallback (web_fetch)');
    expect(result.output).toContain('Lightweight content');
  });

  it('falls back when the configured Python executable cannot be started', async () => {
    const missingPython = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    const spawn = fakeSpawn({ error: missingPython });
    const fetchPage = vi.fn().mockResolvedValue({ success: true, output: 'Fallback content' });
    const result = await new WebScrapeTool({ spawn, checkUrl: safeCheck, fetchPage }).execute({ url: SAFE_URL });

    expect(result.success).toBe(true);
    expect(result.output).toContain('fallback (web_fetch)');
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it('can disable fallback and guides the user to --setup', async () => {
    const fetchPage = vi.fn();
    const result = await new WebScrapeTool({
      env: { ...process.env, CODEBUDDY_SCRAPLING_NO_FALLBACK: 'true' },
      checkUrl: safeCheck,
      runScrapling: async () => ({ ok: false, error: 'scrapling-not-installed' }),
      fetchPage,
    }).execute({ url: SAFE_URL });

    expect(result.success).toBe(false);
    expect(result.error).toContain('buddy scrape --setup');
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('does not disguise an installed Scrapling network error as a fallback', async () => {
    const fetchPage = vi.fn();
    const result = await new WebScrapeTool({
      checkUrl: safeCheck,
      runScrapling: async () => ({ ok: false, error: 'connection refused' }),
      fetchPage,
    }).execute({ url: SAFE_URL });

    expect(result.success).toBe(false);
    expect(result.error).toContain('connection refused');
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('returns a clean failure when a spawned sidecar never responds', async () => {
    const spawn = fakeSpawn({ neverClose: true });
    const result = await new WebScrapeTool({ spawn, checkUrl: safeCheck }).execute({
      url: SAFE_URL,
      timeout: 5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out after 5ms');
  });

  it('blocks loopback URLs before spawning Python', async () => {
    const spawn = fakeSpawn({
      stdout: '{"ok":true,"status":200,"engine":"http","markdown":"must not run"}\n',
    });
    const result = await new WebScrapeTool({ spawn }).execute({ url: 'http://127.0.0.1/private' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('SSRF guard');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('parses the final JSON line after noisy Python output', async () => {
    const spawn = fakeSpawn({
      stdout: 'dependency warning\nnot-json\n{"ok":true,"status":200,"engine":"dynamic","text":"Rendered"}\n',
    });
    const result = await new WebScrapeTool({ spawn, checkUrl: safeCheck }).execute({
      url: SAFE_URL,
      mode: 'dynamic',
      format: 'text',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Engine: dynamic');
    expect(result.output).toContain('Rendered');
  });
});
