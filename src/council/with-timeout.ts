/**
 * Shared timeout race for council LLM calls.
 *
 * Constraint: `CodeBuddyClient.chat()` has no AbortSignal support, so a
 * timed-out call cannot be cancelled — the underlying request keeps running
 * (and billing) in the background. What this helper DOES guarantee: the timer
 * is cleared as soon as the race settles and unref'd while pending, so a
 * council run never keeps the process alive waiting on dead timers.
 *
 * @module council/with-timeout
 */

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout >${Math.round(ms / 1000)}s`)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
