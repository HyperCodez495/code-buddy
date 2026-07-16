import { classifyProviderError } from './provider-error-classifier.js';

export type LlmErrorClassification = 'retryable' | 'terminal';

export interface LlmRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  onRetry?: (retry: number, maxRetries: number, delayMs: number, error: unknown) => void;
}

export type LlmStreamRetryEvent<T> =
  | { type: 'value'; value: T }
  | { type: 'retry'; retry: number; maxRetries: number; delayMs: number; error: unknown };

const TERMINAL_MESSAGE =
  /context(?:[- ]window)?(?: length)?|maximum context length|too many tokens|token limit|quota|billing|unauthori[sz]ed|forbidden|invalid api key|authentication|permission denied/iu;
const RETRYABLE_MESSAGE =
  /econnreset|econnrefused|etimedout|ehostunreach|enetwork|epipe|socket hang up|fetch failed|network error|stream (?:was )?(?:cut|closed|terminated)|unexpected end|stalled?|stall timeout/iu;

/** Classify an LLM/stream failure. Unknown errors fail closed as terminal. */
export function classifyLlmError(error: unknown): LlmErrorClassification {
  const message = error instanceof Error
    ? `${error.name} ${error.message}`
    : typeof error === 'string'
      ? error
      : '';

  if (TERMINAL_MESSAGE.test(message)) return 'terminal';
  const providerClassification = classifyProviderError(error);
  if (providerClassification.fatal) return 'terminal';
  if (providerClassification.retryable || RETRYABLE_MESSAGE.test(message)) return 'retryable';
  return 'terminal';
}

function abortError(): Error {
  const error = new Error('LLM retry aborted by signal');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function retryDelay(error: unknown, retry: number, options: LlmRetryOptions): number {
  const serverDelay = classifyProviderError(error).retryAfterMs;
  if (serverDelay !== undefined) return serverDelay;
  const baseDelay = Math.max(0, options.baseDelayMs ?? 500);
  const maxDelay = Math.max(baseDelay, options.maxDelayMs ?? 8_000);
  return Math.min(baseDelay * (2 ** Math.max(0, retry - 1)), maxDelay);
}

async function delayWithAbort(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    timer.unref?.();
    const onAbort = (): void => {
      cleanup();
      reject(abortError());
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function runWithAbort<T>(
  operation: () => Promise<T> | T,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  const pending = Promise.resolve().then(operation);
  if (!signal) return await pending;

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = (): void => finish(() => reject(abortError()));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    void pending.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

/** Retry a promise-returning provider operation with bounded backoff. */
export async function withLlmRetry<T>(
  operation: () => Promise<T> | T,
  options: LlmRetryOptions = {},
): Promise<T> {
  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  let retries = 0;

  while (true) {
    throwIfAborted(options.signal);
    try {
      return await runWithAbort(operation, options.signal);
    } catch (error) {
      throwIfAborted(options.signal);
      if (classifyLlmError(error) === 'terminal' || retries >= maxRetries) throw error;
      retries++;
      const delayMs = retryDelay(error, retries, options);
      options.onRetry?.(retries, maxRetries, delayMs, error);
      await delayWithAbort(delayMs, options.signal);
    }
  }
}

/** Retry a fresh async stream and surface retry boundaries to the caller. */
export async function* withLlmStreamRetry<T>(
  factory: () => AsyncIterable<T>,
  options: LlmRetryOptions = {},
): AsyncGenerator<LlmStreamRetryEvent<T>> {
  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  let retries = 0;

  while (true) {
    throwIfAborted(options.signal);
    try {
      for await (const value of factory()) {
        throwIfAborted(options.signal);
        yield { type: 'value', value };
      }
      return;
    } catch (error) {
      throwIfAborted(options.signal);
      if (classifyLlmError(error) === 'terminal' || retries >= maxRetries) throw error;
      retries++;
      const delayMs = retryDelay(error, retries, options);
      options.onRetry?.(retries, maxRetries, delayMs, error);
      yield { type: 'retry', retry: retries, maxRetries, delayMs, error };
      await delayWithAbort(delayMs, options.signal);
    }
  }
}
