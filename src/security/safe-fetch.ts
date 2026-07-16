import type { LookupOptions } from 'node:dns';
import { Agent, type Dispatcher } from 'undici';
import { logger } from '../utils/logger.js';
import { assertSafeUrl, type SSRFCheckResult } from './ssrf-guard.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SafeFetchOptions {
  maxRedirects?: number;
}

function shouldRewriteToGet(status: number, method: string): boolean {
  return status === 303 || ((status === 301 || status === 302) && method === 'POST');
}

type PinnedAddress = NonNullable<SSRFCheckResult['addresses']>[number];

interface RequestInitWithDispatcher extends RequestInit {
  dispatcher?: Dispatcher;
}

async function assertRedirectTargetIsSafe(url: string): Promise<SSRFCheckResult> {
  const check = await assertSafeUrl(url);
  if (!check.safe) {
    throw new Error(`URL blocked by SSRF guard: ${check.reason}`);
  }
  return check;
}

function createPinnedDispatcher(pinned: PinnedAddress): Agent {
  try {
    return new Agent({
      connect: {
        lookup: (
          _hostname: string,
          options: LookupOptions,
          callback: (
            error: NodeJS.ErrnoException | null,
            address: string | Array<{ address: string; family: number }>,
            family?: number,
          ) => void,
        ): void => {
          if (options.all) {
            callback(null, [{ address: pinned.address, family: pinned.family }]);
            return;
          }
          callback(null, pinned.address, pinned.family);
        },
      },
    });
  } catch (err) {
    throw new Error(`SSRF DNS pinning dispatcher is unavailable: ${err}`);
  }
}

async function fetchWithOptionalPinning(
  url: string,
  init: RequestInit,
  pinned: PinnedAddress | undefined,
): Promise<Response> {
  if (!pinned) {
    return fetch(url, init);
  }

  const dispatcher = createPinnedDispatcher(pinned);
  try {
    const pinnedInit: RequestInitWithDispatcher = { ...init, dispatcher };
    return await fetch(url, pinnedInit);
  } finally {
    // Do not await graceful close here: fetch resolves when headers arrive, while
    // close resolves after the caller consumes the response body.
    void dispatcher.close().catch(err => {
      logger.warn('Failed to close SSRF DNS pinning dispatcher', { url, err });
    });
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
    const check = await assertRedirectTargetIsSafe(currentUrl);
    const [pinnedAddress] = check.addresses ?? [];

    const response = await fetchWithOptionalPinning(currentUrl, {
      ...init,
      method: currentMethod,
      headers: currentHeaders,
      body: currentBody,
      redirect: 'manual',
    }, pinnedAddress);

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      return response;
    }

    // This response is not returned to a caller, so release its body explicitly.
    // That lets the per-hop dispatcher's graceful close complete promptly.
    await response.body?.cancel();

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
