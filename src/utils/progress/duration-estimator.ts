/**
 * Rolling per-kind duration estimator for `time-anchored` progress.
 *
 * Keeps the last N observed durations for each task `kind` and returns their
 * median as the expected duration. The median (not the mean) keeps a single
 * pathologically slow run from blowing up the estimate. Until enough samples
 * exist, a per-kind seed (or a global default) is used so the very first run
 * still shows a believable bar.
 */
export interface DurationEstimatorOptions {
  /** Per-kind seed estimates (ms) used before any sample is recorded. */
  defaults?: Record<string, number>;
  /** Fallback estimate (ms) when a kind has neither samples nor a seed. */
  fallbackMs?: number;
  /** How many recent samples to keep per kind. */
  maxSamples?: number;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // Non-null: sorted is non-empty and mid is a valid index.
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

export class DurationEstimator {
  private readonly samples = new Map<string, number[]>();
  private readonly defaults: Record<string, number>;
  private readonly fallbackMs: number;
  private readonly maxSamples: number;

  constructor(opts: DurationEstimatorOptions = {}) {
    this.defaults = opts.defaults ?? {};
    this.fallbackMs = opts.fallbackMs ?? 30_000;
    this.maxSamples = Math.max(1, opts.maxSamples ?? 20);
  }

  /** Expected duration (ms) for the next task of this kind. */
  estimate(kind: string): number {
    const samples = this.samples.get(kind);
    if (samples && samples.length > 0) {
      const m = median(samples);
      if (m > 0) return m;
    }
    return this.defaults[kind] ?? this.fallbackMs;
  }

  /** Record an observed duration (ms). Non-finite / non-positive values are ignored. */
  record(kind: string, ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    const samples = this.samples.get(kind) ?? [];
    samples.push(ms);
    while (samples.length > this.maxSamples) samples.shift();
    this.samples.set(kind, samples);
  }

  /** Replace the sample history for a kind (e.g. when hydrating from disk). */
  seed(kind: string, samplesMs: readonly number[]): void {
    const clean = samplesMs.filter((m) => Number.isFinite(m) && m > 0).slice(-this.maxSamples);
    if (clean.length > 0) this.samples.set(kind, clean);
  }

  /** Snapshot of recorded samples, for persistence. */
  export(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const [kind, samples] of this.samples) out[kind] = [...samples];
    return out;
  }
}
