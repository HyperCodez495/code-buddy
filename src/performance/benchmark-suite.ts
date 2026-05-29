/**
 * Benchmark Suite for LLM Performance
 *
 * Comprehensive benchmarking for:
 * - TTFT (Time To First Token)
 * - TPS (Tokens Per Second)
 * - Latency percentiles (p50, p95, p99)
 * - VRAM usage
 * - Cost per request
 * - Cache hit rates
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { countTokens, calculateCost } from '../utils/token-counter.js';

// ============================================================================
// Types
// ============================================================================

export interface BenchmarkConfig {
  /** Number of warmup runs before actual benchmark */
  warmupRuns?: number;
  /** Number of benchmark runs */
  runs?: number;
  /** Concurrent requests (for throughput testing) */
  concurrency?: number;
  /** Timeout per request in ms */
  timeout?: number;
  /** Whether to include VRAM monitoring */
  monitorVRAM?: boolean;
  /** Test prompts to use */
  prompts?: BenchmarkPrompt[];
}

export interface BenchmarkPrompt {
  name: string;
  prompt: string;
  expectedTokens?: number;
  category?: 'simple' | 'moderate' | 'complex' | 'code' | 'reasoning';
}

export interface BenchmarkRun {
  promptName: string;
  startTime: number;
  endTime: number;
  ttft: number; // Time to first token (ms)
  totalTime: number; // Total response time (ms)
  inputTokens: number;
  outputTokens: number;
  tps: number; // Tokens per second
  cost: number;
  success: boolean;
  error?: string;
  vramUsage?: number; // MB
}

export interface BenchmarkResults {
  model: string;
  timestamp: Date;
  config: BenchmarkConfig;
  runs: BenchmarkRun[];
  summary: BenchmarkSummary;
}

export interface BenchmarkSummary {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  ttft: PercentileStats;
  totalTime: PercentileStats;
  tps: PercentileStats;
  inputTokens: { total: number; average: number };
  outputTokens: { total: number; average: number };
  cost: { total: number; average: number };
  throughput: number; // Requests per second
  vram?: { min: number; max: number; average: number };
}

export interface PercentileStats {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  stdDev: number;
}

export type BenchmarkCallback = (
  prompt: string,
  onFirstToken?: () => void
) => Promise<{
  content: string;
  inputTokens?: number;
  outputTokens?: number;
}>;

// ============================================================================
// Default Prompts
// ============================================================================

export const DEFAULT_PROMPTS: BenchmarkPrompt[] = [
  {
    name: 'simple-greeting',
    prompt: 'Hello, how are you?',
    category: 'simple',
    expectedTokens: 20,
  },
  {
    name: 'code-fibonacci',
    prompt: 'Write a Python function to compute the nth Fibonacci number efficiently.',
    category: 'code',
    expectedTokens: 150,
  },
  {
    name: 'code-review',
    prompt: `Review this code and suggest improvements:
\`\`\`python
def calc(x):
    if x == 0:
        return 0
    elif x == 1:
        return 1
    else:
        return calc(x-1) + calc(x-2)
\`\`\``,
    category: 'code',
    expectedTokens: 200,
  },
  {
    name: 'reasoning-math',
    prompt: 'A bat and ball cost $1.10 together. The bat costs $1.00 more than the ball. How much does the ball cost? Explain your reasoning step by step.',
    category: 'reasoning',
    expectedTokens: 150,
  },
  {
    name: 'complex-architecture',
    prompt: 'Design a microservices architecture for an e-commerce platform. Include service names, communication patterns, and data storage recommendations.',
    category: 'complex',
    expectedTokens: 400,
  },
];

// ============================================================================
// Benchmark Suite
// ============================================================================

export class BenchmarkSuite extends EventEmitter {
  private config: Required<BenchmarkConfig>;
  private runs: BenchmarkRun[] = [];
  private isRunning = false;

  constructor(config: BenchmarkConfig = {}) {
    super();
    this.config = {
      warmupRuns: config.warmupRuns ?? 2,
      runs: config.runs ?? 10,
      concurrency: config.concurrency ?? 1,
      timeout: config.timeout ?? 60000,
      monitorVRAM: config.monitorVRAM ?? false,
      prompts: config.prompts ?? DEFAULT_PROMPTS,
    };
  }

  /**
   * Run the benchmark suite
   */
  async run(
    model: string,
    callback: BenchmarkCallback
  ): Promise<BenchmarkResults> {
    if (this.isRunning) {
      throw new Error('Benchmark already running');
    }

    this.isRunning = true;
    this.runs = [];

    const startTime = Date.now();

    try {
      // Warmup runs
      this.emit('phase', { phase: 'warmup', total: this.config.warmupRuns });
      for (let i = 0; i < this.config.warmupRuns; i++) {
        const prompts = this.config.prompts;
        const prompt = prompts[i % prompts.length];
        if (!prompt) throw new Error('Benchmark requires at least one prompt');
        this.emit('warmup', { run: i + 1, total: this.config.warmupRuns });
        await this.executeRun(prompt, callback, true);
      }

      // Actual benchmark runs
      this.emit('phase', { phase: 'benchmark', total: this.config.runs });

      if (this.config.concurrency > 1) {
        // Concurrent benchmark
        await this.runConcurrent(callback);
      } else {
        // Sequential benchmark
        await this.runSequential(callback);
      }

      const totalTime = Date.now() - startTime;
      const summary = this.calculateSummary(totalTime);

      const results: BenchmarkResults = {
        model,
        timestamp: new Date(),
        config: this.config,
        runs: this.runs,
        summary,
      };

      this.emit('complete', results);
      return results;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run benchmarks sequentially
   */
  private async runSequential(callback: BenchmarkCallback): Promise<void> {
    for (let i = 0; i < this.config.runs; i++) {
      const prompts = this.config.prompts;
      const prompt = prompts[i % prompts.length];
      if (!prompt) throw new Error('Benchmark requires at least one prompt');
      this.emit('run', { run: i + 1, total: this.config.runs, prompt: prompt.name });

      const run = await this.executeRun(prompt, callback, false);
      this.runs.push(run);

      this.emit('runComplete', { run: i + 1, result: run });
    }
  }

  /**
   * Run benchmarks concurrently
   */
  private async runConcurrent(callback: BenchmarkCallback): Promise<void> {
    const batches = Math.ceil(this.config.runs / this.config.concurrency);

    for (let batch = 0; batch < batches; batch++) {
      const batchStart = batch * this.config.concurrency;
      const batchSize = Math.min(
        this.config.concurrency,
        this.config.runs - batchStart
      );

      const promises: Promise<BenchmarkRun>[] = [];

      for (let i = 0; i < batchSize; i++) {
        const runIndex = batchStart + i;
        const prompts = this.config.prompts;
        const prompt = prompts[runIndex % prompts.length];
        if (!prompt) throw new Error('Benchmark requires at least one prompt');

        this.emit('run', {
          run: runIndex + 1,
          total: this.config.runs,
          prompt: prompt.name,
          concurrent: true,
        });

        promises.push(this.executeRun(prompt, callback, false));
      }

      const results = await Promise.all(promises);
      this.runs.push(...results);

      this.emit('batchComplete', {
        batch: batch + 1,
        totalBatches: batches,
        results,
      });
    }
  }

  /**
   * Execute a single benchmark run
   */
  private async executeRun(
    prompt: BenchmarkPrompt,
    callback: BenchmarkCallback,
    isWarmup: boolean
  ): Promise<BenchmarkRun> {
    const startTime = Date.now();
    let ttft = 0;
    let firstTokenTime = 0;

    const onFirstToken = () => {
      if (firstTokenTime === 0) {
        firstTokenTime = Date.now();
        ttft = firstTokenTime - startTime;
      }
    };

    try {
      const result = await Promise.race([
        callback(prompt.prompt, onFirstToken),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), this.config.timeout)
        ),
      ]);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Calculate tokens
      const inputTokens = result.inputTokens ?? countTokens(prompt.prompt);
      const outputTokens = result.outputTokens ?? countTokens(result.content);

      // Calculate TPS (output tokens / decode time)
      const decodeTime = totalTime - ttft;
      const tps = decodeTime > 0 ? (outputTokens / decodeTime) * 1000 : 0;

      // Calculate cost (use generic model for estimation)
      const costInfo = calculateCost(inputTokens, outputTokens, 'gpt-4o-mini');

      const run: BenchmarkRun = {
        promptName: prompt.name,
        startTime,
        endTime,
        ttft: ttft || totalTime, // If no TTFT, use total time
        totalTime,
        inputTokens,
        outputTokens,
        tps,
        cost: costInfo.totalCost,
        success: true,
      };

      if (!isWarmup) {
        logger.debug('Benchmark run complete', {
          prompt: prompt.name,
          ttft: `${run.ttft}ms`,
          totalTime: `${run.totalTime}ms`,
          tps: run.tps.toFixed(1),
        });
      }

      return run;
    } catch (error) {
      const endTime = Date.now();
      return {
        promptName: prompt.name,
        startTime,
        endTime,
        ttft: 0,
        totalTime: endTime - startTime,
        inputTokens: countTokens(prompt.prompt),
        outputTokens: 0,
        tps: 0,
        cost: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(totalBenchmarkTime: number): BenchmarkSummary {
    const successful = this.runs.filter((r) => r.success);
    const failed = this.runs.filter((r) => !r.success);

    const ttftValues = successful.map((r) => r.ttft);
    const totalTimeValues = successful.map((r) => r.totalTime);
    const tpsValues = successful.map((r) => r.tps);
    const vramValues = successful.filter((r) => r.vramUsage).map((r) => r.vramUsage!);

    const totalInputTokens = successful.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOutputTokens = successful.reduce((sum, r) => sum + r.outputTokens, 0);
    const totalCost = successful.reduce((sum, r) => sum + r.cost, 0);

    return {
      totalRuns: this.runs.length,
      successfulRuns: successful.length,
      failedRuns: failed.length,
      ttft: this.calculatePercentiles(ttftValues),
      totalTime: this.calculatePercentiles(totalTimeValues),
      tps: this.calculatePercentiles(tpsValues),
      inputTokens: {
        total: totalInputTokens,
        average: successful.length > 0 ? totalInputTokens / successful.length : 0,
      },
      outputTokens: {
        total: totalOutputTokens,
        average: successful.length > 0 ? totalOutputTokens / successful.length : 0,
      },
      cost: {
        total: totalCost,
        average: successful.length > 0 ? totalCost / successful.length : 0,
      },
      throughput: successful.length / (totalBenchmarkTime / 1000),
      ...(vramValues.length > 0 && {
        vram: {
          min: Math.min(...vramValues),
          max: Math.max(...vramValues),
          average: vramValues.reduce((a, b) => a + b, 0) / vramValues.length,
        },
      }),
    };
  }

  /**
   * Calculate percentile statistics
   */
  private calculatePercentiles(values: number[]): PercentileStats {
    if (values.length === 0) {
      return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, stdDev: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    // Standard deviation
    const squaredDiffs = values.map((v) => Math.pow(v - avg, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(avgSquaredDiff);

    return {
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      avg,
      p50: this.percentile(sorted, 50),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
      stdDev,
    };
  }

  /**
   * Calculate a specific percentile
   */
  private percentile(sorted: number[], p: number): number {
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    const lo = sorted[lower] ?? 0;
    const hi = sorted[upper] ?? 0;

    if (lower === upper) {
      return lo;
    }

    const weight = index - lower;
    return lo * (1 - weight) + hi * weight;
  }

  /**
   * Format results for display
   */
  formatResults(results: BenchmarkResults): string {
    const { summary } = results;
    const lines: string[] = [];

    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push(`  BENCHMARK RESULTS: ${results.model}`);
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('');

    lines.push(`  Runs: ${summary.successfulRuns}/${summary.totalRuns} successful`);
    lines.push(`  Throughput: ${summary.throughput.toFixed(2)} req/s`);
    lines.push('');

    lines.push('  ┌─────────────────────────────────────────────────────────────┐');
    lines.push('  │ LATENCY                                                     │');
    lines.push('  ├─────────────────────────────────────────────────────────────┤');
    lines.push(`  │ TTFT:       p50=${summary.ttft.p50.toFixed(0)}ms  p95=${summary.ttft.p95.toFixed(0)}ms  p99=${summary.ttft.p99.toFixed(0)}ms`);
    lines.push(`  │ Total:      p50=${summary.totalTime.p50.toFixed(0)}ms  p95=${summary.totalTime.p95.toFixed(0)}ms  p99=${summary.totalTime.p99.toFixed(0)}ms`);
    lines.push('  └─────────────────────────────────────────────────────────────┘');
    lines.push('');

    lines.push('  ┌─────────────────────────────────────────────────────────────┐');
    lines.push('  │ THROUGHPUT                                                  │');
    lines.push('  ├─────────────────────────────────────────────────────────────┤');
    lines.push(`  │ TPS:        avg=${summary.tps.avg.toFixed(1)}  p50=${summary.tps.p50.toFixed(1)}  p95=${summary.tps.p95.toFixed(1)}`);
    lines.push(`  │ Tokens:     in=${summary.inputTokens.total}  out=${summary.outputTokens.total}`);
    lines.push('  └─────────────────────────────────────────────────────────────┘');
    lines.push('');

    lines.push('  ┌─────────────────────────────────────────────────────────────┐');
    lines.push('  │ COST                                                        │');
    lines.push('  ├─────────────────────────────────────────────────────────────┤');
    lines.push(`  │ Total:      $${summary.cost.total.toFixed(4)}`);
    lines.push(`  │ Per request: $${summary.cost.average.toFixed(6)}`);
    lines.push('  └─────────────────────────────────────────────────────────────┘');
    lines.push('');

    if (summary.vram) {
      lines.push('  ┌─────────────────────────────────────────────────────────────┐');
      lines.push('  │ VRAM                                                        │');
      lines.push('  ├─────────────────────────────────────────────────────────────┤');
      lines.push(`  │ Min: ${summary.vram.min.toFixed(0)}MB  Max: ${summary.vram.max.toFixed(0)}MB  Avg: ${summary.vram.average.toFixed(0)}MB`);
      lines.push('  └─────────────────────────────────────────────────────────────┘');
      lines.push('');
    }

    lines.push('═══════════════════════════════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Export results to JSON
   */
  exportJSON(results: BenchmarkResults): string {
    return JSON.stringify(results, null, 2);
  }

  /**
   * Compare two benchmark results
   */
  compare(
    baseline: BenchmarkResults,
    current: BenchmarkResults
  ): BenchmarkComparison {
    const ttftDiff = this.percentDiff(baseline.summary.ttft.p50, current.summary.ttft.p50);
    const tpsDiff = this.percentDiff(baseline.summary.tps.avg, current.summary.tps.avg);
    const costDiff = this.percentDiff(baseline.summary.cost.average, current.summary.cost.average);

    return {
      baseline: baseline.model,
      current: current.model,
      ttft: {
        baseline: baseline.summary.ttft.p50,
        current: current.summary.ttft.p50,
        diff: ttftDiff,
        improved: ttftDiff < 0,
      },
      tps: {
        baseline: baseline.summary.tps.avg,
        current: current.summary.tps.avg,
        diff: tpsDiff,
        improved: tpsDiff > 0,
      },
      cost: {
        baseline: baseline.summary.cost.average,
        current: current.summary.cost.average,
        diff: costDiff,
        improved: costDiff < 0,
      },
    };
  }

  private percentDiff(baseline: number, current: number): number {
    if (baseline === 0) return 0;
    return ((current - baseline) / baseline) * 100;
  }

  /**
   * Get current config
   */
  getConfig(): Required<BenchmarkConfig> {
    return { ...this.config };
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<BenchmarkConfig>): void {
    Object.assign(this.config, config);
  }
}

export interface BenchmarkComparison {
  baseline: string;
  current: string;
  ttft: {
    baseline: number;
    current: number;
    diff: number;
    improved: boolean;
  };
  tps: {
    baseline: number;
    current: number;
    diff: number;
    improved: boolean;
  };
  cost: {
    baseline: number;
    current: number;
    diff: number;
    improved: boolean;
  };
}

// ============================================================================
// Singleton
// ============================================================================

let benchmarkInstance: BenchmarkSuite | null = null;

export function getBenchmarkSuite(config?: BenchmarkConfig): BenchmarkSuite {
  if (!benchmarkInstance) {
    benchmarkInstance = new BenchmarkSuite(config);
  }
  return benchmarkInstance;
}

export function resetBenchmarkSuite(): void {
  benchmarkInstance = null;
}
