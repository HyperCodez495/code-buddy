/**
 * Publish a vision-training benchmark to the Collective Knowledge Graph, so the
 * robot's brain RETAINS its perception weaknesses across runs (the "learning"
 * half of train-the-brain). Each weak spot becomes a `discovery` node; a clean
 * run records a positive baseline. Ingestion is INJECTED so this is testable
 * without a ledger, and the CLI only calls it behind CODEBUDDY_COLLECTIVE_MEMORY.
 */
import type { Benchmark } from './scorer.js';

/** Minimal slice of the CKG we depend on (matches CollectiveKnowledgeGraph.ingest). */
export interface CkgIngestor {
  ingest(input: {
    text: string;
    name?: string;
    source?: string;
    confidence?: number;
  }): Promise<unknown>;
}

export interface PublishMeta {
  source: string; // image source (folder/generated)
  model?: string;
}

/**
 * Ingest the benchmark's weak spots (or a clean-baseline note) as discoveries.
 * Returns the number of nodes written. Never throws for an empty benchmark.
 */
export async function publishBenchmark(
  benchmark: Benchmark,
  meta: PublishMeta,
  ckg: CkgIngestor,
): Promise<number> {
  if (benchmark.scenes === 0) return 0;

  const tag = meta.model ? `${meta.source}, ${meta.model}` : meta.source;
  let written = 0;

  if (benchmark.weakSpots.length > 0) {
    for (const weak of benchmark.weakSpots) {
      await ckg.ingest({
        text: `Robot vision weakness — ${weak} (over ${benchmark.scenes} scenes; ${tag}).`,
        name: `vision-perception weakness: ${weak.slice(0, 72)}`,
        source: 'vision-train',
        // lower accuracy ⇒ higher confidence this is a real, actionable gap
        confidence: clamp(0.6 + (1 - benchmark.accuracy) * 0.35),
      });
      written += 1;
    }
  } else {
    await ckg.ingest({
      text: `Robot vision matched ground truth across ${benchmark.scenes} scenes (accuracy ${(benchmark.accuracy * 100).toFixed(0)}%, mean count error ${benchmark.meanCountError}; ${tag}).`,
      name: `vision-perception baseline: ${tag}`,
      source: 'vision-train',
      confidence: 0.7,
    });
    written += 1;
  }

  return written;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, Math.round(n * 1000) / 1000));
}
