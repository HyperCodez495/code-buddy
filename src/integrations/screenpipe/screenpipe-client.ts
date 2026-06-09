/**
 * ScreenpipeClient — thin client for a locally-running screenpipe instance
 * (https://github.com/mediar-ai/screenpipe), which records screen + audio 24/7
 * and exposes a local REST API on :3030.
 *
 * We consume its `/search` endpoint so Code Buddy can answer "what did I see /
 * say / hear?" from screen+audio history — local-first, no cloud. Base URL is
 * configurable via `SCREENPIPE_URL` (default http://localhost:3030).
 *
 * `fetchImpl` is injectable for tests.
 */
export type ScreenpipeContentType = 'all' | 'ocr' | 'audio' | 'ui';

export interface ScreenpipeSearchOptions {
  query?: string;
  contentType?: ScreenpipeContentType;
  limit?: number;
  offset?: number;
  appName?: string;
  windowName?: string;
  /** ISO-8601, e.g. 2026-06-09T08:00:00Z */
  startTime?: string;
  endTime?: string;
}

export interface ScreenpipeItem {
  type: string; // "OCR" | "Audio" | "UI"
  text?: string;
  timestamp?: string;
  appName?: string;
  windowName?: string;
  filePath?: string;
  browserUrl?: string;
}

export interface ScreenpipeSearchResult {
  items: ScreenpipeItem[];
  total: number;
}

type FetchLike = (url: string, init?: { method?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export class ScreenpipeClient {
  readonly baseUrl: string;
  private readonly doFetch: FetchLike;

  constructor(opts: { baseUrl?: string; fetchImpl?: FetchLike } = {}) {
    this.baseUrl = (opts.baseUrl || process.env['SCREENPIPE_URL'] || 'http://localhost:3030').replace(/\/$/, '');
    this.doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  /** True if a screenpipe server answers on the health endpoint. */
  async health(timeoutMs = 2500): Promise<boolean> {
    try {
      const res = await this.withTimeout((signal) => this.doFetch(`${this.baseUrl}/health`, { signal }), timeoutMs);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Search captured screen/audio content. */
  async search(opts: ScreenpipeSearchOptions = {}, timeoutMs = 15000): Promise<ScreenpipeSearchResult> {
    const params = new URLSearchParams();
    params.set('content_type', opts.contentType ?? 'all');
    params.set('limit', String(opts.limit ?? 10));
    if (opts.query) params.set('q', opts.query);
    if (opts.offset) params.set('offset', String(opts.offset));
    if (opts.appName) params.set('app_name', opts.appName);
    if (opts.windowName) params.set('window_name', opts.windowName);
    if (opts.startTime) params.set('start_time', opts.startTime);
    if (opts.endTime) params.set('end_time', opts.endTime);

    const url = `${this.baseUrl}/search?${params.toString()}`;
    const res = await this.withTimeout((signal) => this.doFetch(url, { signal }), timeoutMs);
    if (!res.ok) {
      throw new Error(`screenpipe /search returned ${res.status}`);
    }
    const body = (await res.json()) as { data?: unknown[]; pagination?: { total?: number } };
    const raw = Array.isArray(body.data) ? body.data : [];
    const items = raw.map((entry) => normalizeItem(entry));
    return { items, total: body.pagination?.total ?? items.length };
  }

  private async withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fn(ctrl.signal);
    } finally {
      clearTimeout(t);
    }
  }
}

/** screenpipe wraps each hit as `{ type, content: {...} }` with snake_case keys. */
function normalizeItem(entry: unknown): ScreenpipeItem {
  const e = (entry ?? {}) as { type?: unknown; content?: Record<string, unknown> };
  const c = (e.content ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const item: ScreenpipeItem = { type: str(e.type) ?? 'unknown' };
  const text = str(c['text']) ?? str(c['transcription']);
  const timestamp = str(c['timestamp']);
  const appName = str(c['app_name']);
  const windowName = str(c['window_name']);
  const filePath = str(c['file_path']);
  const browserUrl = str(c['browser_url']);
  if (text !== undefined) item.text = text;
  if (timestamp !== undefined) item.timestamp = timestamp;
  if (appName !== undefined) item.appName = appName;
  if (windowName !== undefined) item.windowName = windowName;
  if (filePath !== undefined) item.filePath = filePath;
  if (browserUrl !== undefined) item.browserUrl = browserUrl;
  return item;
}
