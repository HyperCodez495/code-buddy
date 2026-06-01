/**
 * Firecrawl Tool
 *
 * Provides web search and scraping via the Firecrawl API.
 * Gated by FIRECRAWL_API_KEY environment variable.
 *
 * Native Engine v2026.3.14 alignment — firecrawl_search + firecrawl_scrape.
 */

import { logger } from '../utils/logger.js';
import { resolveToolGatewayRoute } from '../agent/tool-gateway-router.js';

// ============================================================================
// Types
// ============================================================================

export interface FirecrawlSearchOptions {
  query: string;
  limit?: number;
  lang?: string;
}

export interface FirecrawlSearchResult {
  title: string;
  url: string;
  content: string;
}

export interface FirecrawlScrapeOptions {
  url: string;
  formats?: ('markdown' | 'html' | 'text')[];
  waitFor?: number;
}

export interface FirecrawlScrapeResult {
  url: string;
  markdown: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Firecrawl Client
// ============================================================================

const FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev/v1';
const DEFAULT_TIMEOUT = 30_000;

/**
 * Check if Firecrawl is configured — either a direct API key, or a Nous Tool
 * Gateway route that proxies web search/extraction.
 */
export function isFirecrawlEnabled(): boolean {
  return !!process.env.FIRECRAWL_API_KEY || resolveToolGatewayRoute('web') !== null;
}

/**
 * Get the Firecrawl API key.
 */
function getApiKey(): string {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error('FIRECRAWL_API_KEY environment variable is not set');
  return key;
}

/**
 * Make an authenticated request to the Firecrawl API.
 */
async function firecrawlRequest<T>(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<T> {
  // Route through the Nous Tool Gateway when configured; otherwise call
  // Firecrawl directly. The gateway token replaces the direct API key.
  const route = resolveToolGatewayRoute('web');
  const baseUrl = route?.baseUrl ?? FIRECRAWL_BASE_URL;
  const authorization = route?.token ? `Bearer ${route.token}` : `Bearer ${getApiKey()}`;
  const url = `${baseUrl}${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorization,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Firecrawl API error ${response.status}: ${text || response.statusText}`);
    }

    return await response.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// Tool Methods
// ============================================================================

/**
 * Search the web via Firecrawl.
 */
export async function firecrawlSearch(options: FirecrawlSearchOptions): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  try {
    const result = await firecrawlRequest<{
      success: boolean;
      data?: FirecrawlSearchResult[];
    }>('/search', {
      query: options.query,
      limit: options.limit ?? 5,
      lang: options.lang,
    });

    if (!result.success || !result.data?.length) {
      return { success: true, output: 'No results found.' };
    }

    const formatted = result.data.map((r, i) =>
      `### ${i + 1}. ${r.title}\n**URL:** ${r.url}\n${r.content}\n`
    ).join('\n---\n\n');

    return { success: true, output: `Found ${result.data.length} results:\n\n${formatted}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Firecrawl search error', { error: msg });
    return { success: false, error: `Firecrawl search failed: ${msg}` };
  }
}

/**
 * Scrape a URL via Firecrawl (returns clean markdown).
 */
export async function firecrawlScrape(options: FirecrawlScrapeOptions): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  try {
    const result = await firecrawlRequest<{
      success: boolean;
      data?: FirecrawlScrapeResult;
    }>('/scrape', {
      url: options.url,
      formats: options.formats ?? ['markdown'],
      waitFor: options.waitFor,
    });

    if (!result.success || !result.data) {
      return { success: false, error: 'Firecrawl scrape returned no data.' };
    }

    const { markdown, title, url } = result.data;
    const header = title ? `# ${title}\n**Source:** ${url}\n\n` : `**Source:** ${url}\n\n`;
    const content = markdown || '(empty page)';

    // Truncate very long pages
    const maxLen = 50_000;
    const truncated = content.length > maxLen
      ? content.slice(0, maxLen) + '\n\n...(truncated)'
      : content;

    return { success: true, output: `${header}${truncated}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Firecrawl scrape error', { error: msg });
    return { success: false, error: `Firecrawl scrape failed: ${msg}` };
  }
}
