/**
 * Stall guard for LLM streams.
 *
 * Some backends (observed repeatedly with the ChatGPT/Codex OAuth endpoint)
 * accept the connection and then never send a byte — the reader's
 * `for await` then hangs FOREVER, freezing agent turns and headless waves
 * for hours. This wrapper bounds the wait BETWEEN chunks: no activity for
 * `timeoutMs` → the underlying stream is closed and a clear LlmStallError is
 * thrown, so the turn fails fast and honestly instead of hanging.
 *
 * Tunable via CODEBUDDY_LLM_STALL_TIMEOUT_MS (default 120000; <=0 disables).
 */

export class LlmStallError extends Error {
  constructor(timeoutMs: number) {
    super(
      `LLM stream stalled: no data received for ${Math.round(timeoutMs / 1000)}s ` +
        `(backend accepted the request but stopped responding). ` +
        `Retry the turn; tune with CODEBUDDY_LLM_STALL_TIMEOUT_MS.`,
    );
    this.name = 'LlmStallError';
  }
}

const DEFAULT_STALL_TIMEOUT_MS = 120_000;

/** Resolve the configured inactivity budget (<=0 or NaN disables the guard). */
export function resolveStallTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CODEBUDDY_LLM_STALL_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_STALL_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_STALL_TIMEOUT_MS;
  return parsed;
}

/**
 * Yield the stream's chunks, failing fast when the gap between two chunks
 * (or before the first one) exceeds `timeoutMs`.
 */
export async function* withStallGuard<T>(
  stream: AsyncIterable<T>,
  timeoutMs: number = resolveStallTimeoutMs(),
): AsyncGenerator<T, void, undefined> {
  if (timeoutMs <= 0) {
    yield* stream;
    return;
  }

  const iterator = stream[Symbol.asyncIterator]();
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stall = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new LlmStallError(timeoutMs)), timeoutMs);
      });
      let result: IteratorResult<T>;
      try {
        result = await Promise.race([iterator.next(), stall]);
      } finally {
        clearTimeout(timer);
      }
      if (result.done) return;
      yield result.value;
    }
  } catch (error) {
    // Close the underlying stream (aborts the network request when the
    // provider wires return() to its AbortController). Best effort.
    try {
      await iterator.return?.();
    } catch {
      /* already dead */
    }
    throw error;
  }
}
