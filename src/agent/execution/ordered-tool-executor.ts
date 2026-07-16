/**
 * Split tool calls into ordered execution batches.
 *
 * Consecutive read-only calls share a batch. Every mutating call is isolated,
 * which creates a barrier before and after it. Consumers must process each
 * batch before starting the next one to preserve side-effect ordering.
 */
export function createOrderedToolBatches<T>(
  items: readonly T[],
  isParallelizable: (item: T) => boolean,
): T[][] {
  const batches: T[][] = [];
  let parallelBatch: T[] = [];

  const flushParallelBatch = (): void => {
    if (parallelBatch.length > 0) {
      batches.push(parallelBatch);
      parallelBatch = [];
    }
  };

  for (const item of items) {
    if (isParallelizable(item)) {
      parallelBatch.push(item);
      continue;
    }

    flushParallelBatch();
    batches.push([item]);
  }

  flushParallelBatch();
  return batches;
}

/**
 * Execute a batch with bounded concurrency while returning results in input
 * order. Rejections are converted by `onError`, keeping the caller's hot loop
 * never-throws contract intact.
 */
export async function executeBoundedInOrder<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  onError: (error: unknown, item: T, index: number) => R,
  maxConcurrent = 5,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const concurrency = Math.max(1, Math.min(maxConcurrent, items.length));
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      if (item === undefined) continue;
      try {
        results[index] = await worker(item, index);
      } catch (error) {
        results[index] = onError(error, item, index);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}
