/**
 * Browser Use Gateway Runner
 *
 * Routes browser actions through either:
 *   1. The Browser Use API (via `BROWSER_USE_API_KEY`), or
 *   2. The Nous Tool Gateway (`CODEBUDDY_NOUS_TOOL_GATEWAY_URL`).
 *
 * Returns structured results with optional screenshot data.
 * Falls back gracefully when neither API key nor gateway is configured.
 */

import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserUseRunnerOptions {
  /** Browser Use API key (falls back to `BROWSER_USE_API_KEY` env). */
  apiKey?: string;
  /** Nous Tool Gateway URL (falls back to `CODEBUDDY_NOUS_TOOL_GATEWAY_URL` env). */
  gatewayUrl?: string;
  /** Request timeout in milliseconds (default: 60 000). */
  timeout?: number;
}

export interface BrowserUseActionResult {
  ok: boolean;
  /** Extracted page content or action result text. */
  content?: string;
  /** Base64-encoded screenshot, when the service provides one. */
  screenshot?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 60_000;
const BROWSER_USE_API_URL = 'https://api.browser-use.com/api/v1/run-task';

interface ResolvedEndpoint {
  kind: 'browser-use-api' | 'nous-gateway';
  url: string;
  headers: Record<string, string>;
}

/**
 * Determine which endpoint to use, preferring the Browser Use API when an
 * API key is available, then falling back to the Nous Tool Gateway.
 */
function resolveEndpoint(options: BrowserUseRunnerOptions = {}): ResolvedEndpoint | null {
  const apiKey = options.apiKey ?? process.env.BROWSER_USE_API_KEY?.trim();
  const gatewayUrl = options.gatewayUrl ?? process.env.CODEBUDDY_NOUS_TOOL_GATEWAY_URL?.trim();

  if (apiKey) {
    return {
      kind: 'browser-use-api',
      url: BROWSER_USE_API_URL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    };
  }

  if (gatewayUrl) {
    // The Nous Tool Gateway expects a POST to /browser-use with a JSON body.
    const base = gatewayUrl.replace(/\/+$/, '');
    return {
      kind: 'nous-gateway',
      url: `${base}/browser-use`,
      headers: {
        'Content-Type': 'application/json',
      },
    };
  }

  return null;
}

/**
 * Build the request body matching the Browser Use API schema.
 * The Nous Tool Gateway accepts the same shape.
 */
function buildRequestBody(action: string, url: string): Record<string, unknown> {
  return {
    task: action,
    url,
  };
}

/**
 * Normalise the JSON response into our unified result type.
 * Both endpoints return slightly different shapes but converge on a few
 * common fields.
 */
function normaliseResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: Record<string, any>,
): Pick<BrowserUseActionResult, 'content' | 'screenshot'> {
  return {
    content:
      typeof json.result === 'string' ? json.result
        : typeof json.content === 'string' ? json.content
          : typeof json.output === 'string' ? json.output
            : typeof json.text === 'string' ? json.text
              : JSON.stringify(json),
    screenshot:
      typeof json.screenshot === 'string' ? json.screenshot : undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a browser action through the Browser Use service.
 *
 * ```ts
 * const result = await executeBrowserUseAction(
 *   'Extract the main heading',
 *   'https://example.com',
 * );
 * if (result.ok) console.log(result.content);
 * ```
 */
export async function executeBrowserUseAction(
  action: string,
  url: string,
  options: BrowserUseRunnerOptions = {},
): Promise<BrowserUseActionResult> {
  const endpoint = resolveEndpoint(options);

  if (!endpoint) {
    return {
      ok: false,
      error:
        'Browser Use is not configured. Set BROWSER_USE_API_KEY or CODEBUDDY_NOUS_TOOL_GATEWAY_URL.',
    };
  }

  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    logger.debug(
      `[browser-use-runner] ${endpoint.kind} → POST ${endpoint.url} (action=${action.slice(0, 80)})`,
    );

    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: endpoint.headers,
      body: JSON.stringify(buildRequestBody(action, url)),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const message = `${endpoint.kind} returned HTTP ${response.status}: ${body.slice(0, 200)}`;
      logger.warn(`[browser-use-runner] ${message}`);
      return { ok: false, error: message };
    }

    const json = (await response.json()) as Record<string, unknown>;
    const { content, screenshot } = normaliseResponse(json);

    return { ok: true, content, screenshot };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const errorText = isAbort
      ? `Request to ${endpoint.kind} timed out after ${timeoutMs}ms.`
      : `${endpoint.kind} request failed: ${message}`;
    logger.warn(`[browser-use-runner] ${errorText}`);
    return { ok: false, error: errorText };
  }
}
