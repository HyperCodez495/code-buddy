import { assertSafeUrl } from './ssrf-guard.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SafeFetchOptions {
  maxRedirects?: number;
}

function shouldRewriteToGet(status: number, method: string): boolean {
  return status === 303 || ((status === 301 || status === 302) && method === 'POST');
}

async function assertRedirectTargetIsSafe(url: string): Promise<void> {
  const check = await assertSafeUrl(url);
  if (!check.safe) {
    throw new Error(`URL blocked by SSRF guard: ${check.reason}`);
  }
}

/**
 * Fetch an HTTP(S) resource while validating every redirect target before it is requested.
 */
export async function safeFetchFollow(
  url: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5;
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
    throw new Error('maxRedirects must be a non-negative integer');
  }

  let currentUrl = new URL(url).toString();
  let currentMethod = (init.method ?? 'GET').toUpperCase();
  let currentBody = init.body;
  let currentHeaders = new Headers(init.headers);

  for (let redirectCount = 0; ; redirectCount += 1) {
    await assertRedirectTargetIsSafe(currentUrl);

    const response = await fetch(currentUrl, {
      ...init,
      method: currentMethod,
      headers: currentHeaders,
      body: currentBody,
      redirect: 'manual',
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      return response;
    }
    if (redirectCount >= maxRedirects) {
      throw new Error(`Too many redirects (maximum ${maxRedirects})`);
    }

    const nextUrl = new URL(location, currentUrl);
    const currentOrigin = new URL(currentUrl).origin;
    if (nextUrl.origin !== currentOrigin) {
      currentHeaders = new Headers(currentHeaders);
      currentHeaders.delete('authorization');
    }

    if (shouldRewriteToGet(response.status, currentMethod)) {
      currentMethod = 'GET';
      currentBody = undefined;
      currentHeaders = new Headers(currentHeaders);
      currentHeaders.delete('content-length');
      currentHeaders.delete('content-type');
    }

    currentUrl = nextUrl.toString();
  }
}
