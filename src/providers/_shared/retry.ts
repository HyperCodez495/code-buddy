/**
 * @phuetz/ai-providers — Retry Utility
 *
 * Exponential backoff with jitter for resilient LLM API calls.
 * Shared between Code Buddy and Lisa.
 */

// ============================================================================
// Types
// ============================================================================

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3). */
  maxRetries?: number;
  /** Initial delay in ms (default: 1000). */
  baseDelay?: number;
  /** Maximum delay cap in ms (default: 30000). */
  maxDelay?: number;
  /** Backoff multiplier (default: 2). */
  backoffFactor?: number;
  /** Add random jitter to prevent thundering herd (default: true). */
  jitter?: boolean;
  /** Absolute timeout in ms (0 = no timeout). */
  timeout?: number;
  /** Predicate: should this error be retried? */
  isRetryable?: (error: unknown) => boolean;
  /** Callback on each retry attempt. */
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
  /** Callback when all retries exhausted. */
  onFailed?: (error: unknown, attempts: number) => void;
  /** Callback on success. */
  onSuccess?: (result: unknown, attempts: number) => void;
  /** AbortSignal to cancel retries. */
  signal?: AbortSignal;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalTimeMs: number;
}

// ============================================================================
// Pre-built Strategies
// ============================================================================

export const RetryStrategies = {
  /** Fast retries for local operations. */
  fast: { maxRetries: 3, baseDelay: 100, maxDelay: 1000, backoffFactor: 2 } as RetryOptions,
  /** Standard retry for general API calls. */
  standard: { maxRetries: 3, baseDelay: 1000, maxDelay: 10000, backoffFactor: 2 } as RetryOptions,
  /** Aggressive retry for critical operations. */
  aggressive: { maxRetries: 5, baseDelay: 500, maxDelay: 30000, backoffFactor: 2 } as RetryOptions,
  /** Patient retry for slow services. */
  patient: { maxRetries: 10, baseDelay: 2000, maxDelay: 60000, backoffFactor: 1.5 } as RetryOptions,
  /** Optimized for LLM API calls (low latency, rate-limit aware). */
  llmApi: { maxRetries: 3, baseDelay: 200, maxDelay: 2000, jitter: true, backoffFactor: 2 } as RetryOptions,
  /** Cloud storage operations. */
  cloudStorage: { maxRetries: 5, baseDelay: 500, maxDelay: 15000, backoffFactor: 2 } as RetryOptions,
  /** Web requests. */
  webRequest: { maxRetries: 3, baseDelay: 500, maxDelay: 5000, backoffFactor: 2 } as RetryOptions,
  /** No retries. */
  none: { maxRetries: 0 } as RetryOptions,
} as const;

// ============================================================================
// Error Predicates
// ============================================================================

export const RetryPredicates = {
  /** Network-level errors (ECONNRESET, ETIMEDOUT, etc.). */
  networkError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return (
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('econnrefused') ||
      msg.includes('socket hang up') ||
      msg.includes('network') ||
      msg.includes('fetch failed')
    );
  },

  /** Server errors (HTTP 500-504). */
  serverError(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    return status !== undefined && status >= 500 && status <= 504;
  },

  /** Rate limit errors (HTTP 429). */
  rateLimitError(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    const code = (error as { code?: string })?.code;
    return status === 429 || code === 'rate_limit_exceeded';
  },

  /** Combined: LLM API retryable errors. */
  llmApiError(error: unknown): boolean {
    return (
      RetryPredicates.networkError(error) ||
      RetryPredicates.serverError(error) ||
      RetryPredicates.rateLimitError(error)
    );
  },

  /** Combined: any transient error. */
  transientError(error: unknown): boolean {
    return (
      RetryPredicates.networkError(error) ||
      RetryPredicates.serverError(error) ||
      RetryPredicates.rateLimitError(error)
    );
  },

  /** Never retry. */
  never(): boolean {
    return false;
  },

  /** Always retry. */
  always(): boolean {
    return true;
  },
} as const;

// ============================================================================
// Retry Function
// ============================================================================

/**
 * Execute a function with exponential backoff retry.
 *
 * @example
 * ```ts
 * const result = await retry(
 *   () => fetch('https://api.openai.com/v1/chat/completions', { ... }),
 *   { ...RetryStrategies.llmApi, isRetryable: RetryPredicates.llmApiError }
 * );
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    jitter = true,
    timeout = 0,
    isRetryable = RetryPredicates.transientError,
    onRetry,
    onFailed,
    onSuccess,
    signal,
  } = options;

  const startTime = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check abort signal
    if (signal?.aborted) {
      throw new Error('Retry aborted');
    }

    // Check timeout
    if (timeout > 0 && Date.now() - startTime > timeout) {
      throw new Error(`Retry timeout after ${timeout}ms`);
    }

    try {
      const result = await fn();
      onSuccess?.(result, attempt + 1);
      return result;
    } catch (error) {
      lastError = error;

      // Don't retry if not retryable or last attempt
      if (attempt >= maxRetries || !isRetryable(error)) {
        break;
      }

      // Calculate delay with exponential backoff
      let delay = Math.min(baseDelay * Math.pow(backoffFactor, attempt), maxDelay);

      // Add jitter (±25%)
      if (jitter) {
        const jitterRange = delay * 0.25;
        delay += (Math.random() * 2 - 1) * jitterRange;
        delay = Math.max(0, Math.round(delay));
      }

      onRetry?.(error, attempt + 1, delay);

      // Wait before retrying
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        if (signal) {
          const onAbort = () => {
            clearTimeout(timer);
            reject(new Error('Retry aborted'));
          };
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    }
  }

  onFailed?.(lastError, maxRetries + 1);
  throw lastError;
}

/**
 * Execute with retry, returning a result object instead of throwing.
 */
export async function retryWithResult<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const startTime = Date.now();
  let attempts = 0;

  try {
    const result = await retry(fn, {
      ...options,
      onRetry: (error, attempt, delay) => {
        attempts = attempt;
        options.onRetry?.(error, attempt, delay);
      },
    });
    return {
      success: true,
      result,
      attempts: attempts + 1,
      totalTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      attempts: attempts + 1,
      totalTimeMs: Date.now() - startTime,
    };
  }
}
