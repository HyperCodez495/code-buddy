/**
 * Wide Research Mode (Manus AI-inspired)
 *
 * Spawns N parallel sub-agent workers, each handling an independent
 * sub-topic, then aggregates results into a comprehensive report.
 *
 * Architecture:
 *   WideResearchOrchestrator
 *       |
 *       +-- decompose(topic) → string[]   (subtopics via LLM)
 *       |
 *       +-- worker[0..N-1]                (CodeBuddyAgent instances)
 *       |       each: "Research: <subtopic>"
 *       |
 *       +-- aggregate(results) → string   (synthesize via LLM)
 *
 * Each worker gets its own fresh message history and runs concurrently.
 * Results are streamed back via an AsyncGenerator for live progress.
 *
 * Unlike the full multi-agent orchestrator, Wide Research is intentionally
 * flat: workers cannot spawn their own sub-workers. All decomposition
 * happens at the orchestrator level (same pattern as Native Engine's current
 * flat subagent design).
 */

import { EventEmitter } from 'events';
import type { ToolResult } from '../types/index.js';
import type {
  DeepResearchLoopOptions,
  DeepResearchLoopResult,
  DeepResearchBoundaries,
  DeepResearchStage,
  DeepLlmMessage,
  SearchHit,
} from './deep-research.js';

// ============================================================================
// Types
// ============================================================================

export interface WideResearchOptions {
  /** Number of parallel research workers (default: 5, max: 20) */
  workers?: number;
  /** Max tool rounds per worker (default: 15) */
  maxRoundsPerWorker?: number;
  /** Whether to stream partial results as workers finish */
  stream?: boolean;
  /** Additional context injected into each worker's system prompt */
  context?: string;
  /** LLM model for workers (defaults to current agent model) */
  model?: string;
  /** Per-worker timeout in milliseconds (default: 90000) */
  workerTimeoutMs?: number;
  /** Overall research timeout in milliseconds (default: 300000) */
  overallTimeoutMs?: number;
  /** Timeout for decomposition phase in milliseconds (default: 45000) */
  decomposeTimeoutMs?: number;
  /** Timeout for aggregation phase in milliseconds (default: 60000) */
  aggregateTimeoutMs?: number;
}

export interface ResearchWorkerResult {
  subtopic: string;
  workerIndex: number;
  /** Raw research output from the worker */
  output: string;
  /** Whether the worker completed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Duration in ms */
  durationMs: number;
}

export interface WideResearchResult {
  topic: string;
  subtopics: string[];
  workerResults: ResearchWorkerResult[];
  /** Synthesized final report */
  report: string;
  /** Total wall-clock duration */
  durationMs: number;
  /** Number of workers that succeeded */
  successCount: number;
}

export type WideResearchProgress =
  | { type: 'decomposed'; subtopics: string[] }
  | { type: 'worker_start'; workerIndex: number; subtopic: string }
  | { type: 'worker_done'; workerIndex: number; subtopic: string; success: boolean }
  | { type: 'aggregating' }
  | { type: 'done'; result: WideResearchResult };

/** Progress events emitted by the opt-in Deep Research path (distinct channel). */
export type DeepResearchProgress = { type: 'deep' } & DeepResearchStage;

// ============================================================================
// Orchestrator
// ============================================================================

export class WideResearchOrchestrator extends EventEmitter {
  private options: Required<WideResearchOptions>;

  constructor(options: WideResearchOptions = {}) {
    super();
    this.options = {
      workers: Math.min(options.workers ?? 5, 20),
      maxRoundsPerWorker: options.maxRoundsPerWorker ?? 15,
      stream: options.stream ?? true,
      context: options.context ?? '',
      model: options.model ?? '',
      workerTimeoutMs: Math.max(5_000, options.workerTimeoutMs ?? 90_000),
      overallTimeoutMs: Math.max(30_000, options.overallTimeoutMs ?? 300_000),
      decomposeTimeoutMs: Math.max(5_000, options.decomposeTimeoutMs ?? 45_000),
      aggregateTimeoutMs: Math.max(5_000, options.aggregateTimeoutMs ?? 60_000),
    };
  }

  /**
   * Run wide research on a topic.
   * Emits WideResearchProgress events throughout execution.
   */
  async research(
    topic: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>
  ): Promise<WideResearchResult> {
    const startTime = Date.now();
    const deadline = startTime + this.options.overallTimeoutMs;

    // Step 1: Decompose into subtopics
    const subtopics = await this.withTimeout(
      this.decompose(topic, apiKey, providerConfig),
      this.options.decomposeTimeoutMs,
      'decompose phase timed out'
    ).catch(() =>
      Array.from({ length: this.options.workers }, (_, i) => `${topic} - aspect ${i + 1}`)
    );
    this.emit('progress', { type: 'decomposed', subtopics } satisfies WideResearchProgress);

    // Step 2: Run workers in parallel (batched by this.options.workers)
    const workerResults: ResearchWorkerResult[] = [];
    const chunks = this.chunk(subtopics, this.options.workers);

    for (const batch of chunks) {
      const batchPromises = batch.map(async (subtopic, batchIdx) => {
        const workerIndex = workerResults.length + batchIdx;
        this.emit('progress', { type: 'worker_start', workerIndex, subtopic } satisfies WideResearchProgress);

        const workerStart = Date.now();
        const remainingOverallMs = Math.max(1_000, deadline - Date.now());
        if (remainingOverallMs <= 1_000) {
          const result: ResearchWorkerResult = {
            subtopic,
            workerIndex,
            output: '',
            success: false,
            error: 'Skipped: overall research timeout reached',
            durationMs: 0,
          };
          this.emit('progress', { type: 'worker_done', workerIndex, subtopic, success: false } satisfies WideResearchProgress);
          return result;
        }

        try {
          const output = await this.withTimeout(
            this.runWorker(subtopic, topic, apiKey, providerConfig),
            Math.min(this.options.workerTimeoutMs, remainingOverallMs),
            `worker timed out after ${Math.min(this.options.workerTimeoutMs, remainingOverallMs)}ms`
          );
          const result: ResearchWorkerResult = {
            subtopic,
            workerIndex,
            output,
            success: true,
            durationMs: Date.now() - workerStart,
          };
          this.emit('progress', { type: 'worker_done', workerIndex, subtopic, success: true } satisfies WideResearchProgress);
          return result;
        } catch (err) {
          const result: ResearchWorkerResult = {
            subtopic,
            workerIndex,
            output: '',
            success: false,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - workerStart,
          };
          this.emit('progress', { type: 'worker_done', workerIndex, subtopic, success: false } satisfies WideResearchProgress);
          return result;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      workerResults.push(...batchResults);
    }

    // Step 3: Aggregate
    this.emit('progress', { type: 'aggregating' } satisfies WideResearchProgress);
    const remainingOverallMs = Math.max(5_000, deadline - Date.now());
    const report = await this.withTimeout(
      this.aggregate(topic, workerResults, apiKey, providerConfig),
      Math.min(this.options.aggregateTimeoutMs, remainingOverallMs),
      'aggregate phase timed out'
    ).catch(() => this.buildFallbackReport(topic, workerResults));

    const finalResult: WideResearchResult = {
      topic,
      subtopics,
      workerResults,
      report,
      durationMs: Date.now() - startTime,
      successCount: workerResults.filter(r => r.success).length,
    };

    this.emit('progress', { type: 'done', result: finalResult } satisfies WideResearchProgress);
    return finalResult;
  }

  // --------------------------------------------------------------------------
  // Decompose topic → subtopics via a single LLM call
  // --------------------------------------------------------------------------

  private async decompose(
    topic: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>
  ): Promise<string[]> {
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const client = new CodeBuddyClient(
      apiKey,
      providerConfig?.model as string | undefined,
      providerConfig?.baseURL as string | undefined
    );

    const response = await client.chat([
      {
        role: 'system',
        content: `You are a research coordinator. When given a topic, break it into ${this.options.workers} independent, non-overlapping subtopics that together provide comprehensive coverage. Return ONLY a JSON array of strings, no explanation.`,
      },
      {
        role: 'user',
        content: `Topic: ${topic}\n\nReturn exactly ${this.options.workers} subtopics as a JSON array.`,
      },
    ]);

    try {
      const content = response.choices[0]?.message?.content ?? '';
      // Extract JSON array from response
      const match = content.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]) as unknown[];
        if (Array.isArray(parsed)) {
          return parsed
            .filter((s): s is string => typeof s === 'string')
            .slice(0, this.options.workers);
        }
      }
    } catch {
      // Fall back to splitting the topic
    }

    // Fallback: create generic subtopics
    return Array.from({ length: this.options.workers }, (_, i) =>
      `${topic} - aspect ${i + 1}`
    );
  }

  // --------------------------------------------------------------------------
  // Run a single research worker
  // --------------------------------------------------------------------------

  private async runWorker(
    subtopic: string,
    parentTopic: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>
  ): Promise<string> {
    const { CodeBuddyAgent } = await import('./codebuddy-agent.js');

    const agent = new CodeBuddyAgent(
      apiKey,
      providerConfig?.baseURL as string | undefined,
      providerConfig?.model as string | undefined,
      this.options.maxRoundsPerWorker
    );

    let output = '';

    const query = [
      `Research this subtopic thoroughly: "${subtopic}"`,
      `Parent topic: "${parentTopic}"`,
      '',
      'Use web search, browser, and any available tools.',
      'Produce a comprehensive summary with key facts, insights, and sources.',
      'Return only the research report, no meta-commentary.',
    ].join('\n');

    for await (const chunk of agent.processUserMessageStream(query)) {
      if (chunk.type === 'content' && chunk.content) {
        output += chunk.content;
      }
    }

    return output || '(no output from worker)';
  }

  // --------------------------------------------------------------------------
  // Aggregate worker results into a final report
  // --------------------------------------------------------------------------

  private async aggregate(
    topic: string,
    results: ResearchWorkerResult[],
    apiKey: string,
    providerConfig?: Record<string, unknown>
  ): Promise<string> {
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const client = new CodeBuddyClient(
      apiKey,
      providerConfig?.model as string | undefined,
      providerConfig?.baseURL as string | undefined
    );

    const successful = results.filter(r => r.success);
    if (successful.length === 0) {
      return 'All research workers failed. No report available.';
    }

    const sections = successful
      .map(r => `## ${r.subtopic}\n\n${r.output}`)
      .join('\n\n---\n\n');

    const response = await client.chat([
      {
        role: 'system',
        content: `You are a research synthesizer. Combine the provided research sections into a single coherent, well-structured report. Eliminate redundancy, resolve contradictions, and add an executive summary. Use Markdown headings.`,
      },
      {
        role: 'user',
        content: `Topic: ${topic}\n\nResearch sections:\n\n${sections}`,
      },
    ]);

    return response.choices[0]?.message?.content ?? 'Aggregation failed: no content returned.';
  }

  // --------------------------------------------------------------------------
  // Deep Research (Phase A) — opt-in, deterministic, cited pipeline.
  //
  // Additive to `research()`: nothing here runs unless `deepResearch()` is
  // explicitly called. It reuses this orchestrator's parallel batching
  // (`batchMap`) and event channel, and delegates the pure planning/collection/
  // dedup/citation/synthesis logic to `deep-research.ts` (fully injectable).
  // --------------------------------------------------------------------------

  /**
   * Run the GPT-Researcher-style Deep Research pipeline. Wires the real LLM,
   * web-search, and scrape boundaries; every one degrades gracefully. Emits
   * `{ type: 'deep', ... }` progress events. Never throws.
   *
   * Phase B: when `deepOptions.rounds > 1`, this runs the BOUNDED iterative gap
   * loop (research → draft → gap analysis → re-search → convergence). With the
   * default (`rounds` absent / 1) it delegates to the Phase-A single round —
   * byte-identical. The gap-analysis boundary defaults to the `llm` boundary and
   * is only exercised when `rounds > 1`.
   *
   * @param boundariesOverride injected fakes for tests (no network).
   */
  async deepResearch(
    question: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>,
    deepOptions?: DeepResearchLoopOptions,
    boundariesOverride?: Partial<DeepResearchBoundaries>,
  ): Promise<DeepResearchLoopResult> {
    const { runDeepResearchLoop } = await import('./deep-research.js');

    const real = await this.buildDeepBoundaries(apiKey, providerConfig);
    const boundaries: DeepResearchBoundaries = { ...real, ...boundariesOverride };

    return runDeepResearchLoop(
      question,
      boundaries,
      deepOptions ?? {},
      (stage: DeepResearchStage) => {
        this.emit('progress', { type: 'deep', ...stage } satisfies DeepResearchProgress);
      },
    );
  }

  /** Construct the real Deep Research boundaries (LLM / search / scrape / batching). */
  private async buildDeepBoundaries(
    apiKey: string,
    providerConfig?: Record<string, unknown>,
  ): Promise<DeepResearchBoundaries> {
    const model = providerConfig?.model as string | undefined;
    const baseURL = providerConfig?.baseURL as string | undefined;

    const { WebSearchTool } = await import('../tools/web-search.js');
    const webSearch = new WebSearchTool();

    const { isFirecrawlEnabled, firecrawlScrape } = await import('../tools/firecrawl-tool.js');
    const firecrawlReady = (() => {
      try {
        return isFirecrawlEnabled();
      } catch {
        return false;
      }
    })();

    return {
      llm: async (messages: DeepLlmMessage[]): Promise<string> => {
        const { CodeBuddyClient } = await import('../codebuddy/client.js');
        const client = new CodeBuddyClient(apiKey, model, baseURL);
        const response = await client.chat(
          messages.map((m) => ({ role: m.role, content: m.content })),
        );
        return response.choices[0]?.message?.content ?? '';
      },
      search: async (query: string, k: number): Promise<SearchHit[]> => {
        const results = await webSearch.searchStructured(query, { maxResults: k });
        return results
          .filter((r) => typeof r.url === 'string' && r.url.length > 0)
          .map((r) => ({ title: r.title || r.url, url: r.url, snippet: r.snippet || '' }));
      },
      scrape: async (url: string): Promise<string> => {
        try {
          if (firecrawlReady) {
            const r = await firecrawlScrape({ url });
            if (r.success && r.output && r.output.trim().length > 0) return r.output;
          }
        } catch {
          /* fall through to cheap fetch */
        }
        try {
          const r = await webSearch.fetchPage(url);
          if (r.success && r.output && r.output.trim().length > 0) return r.output;
        } catch {
          /* dropped by the pipeline */
        }
        return '';
      },
      mapBatched: <T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> =>
        this.batchMap(items, size, fn),
    };
  }

  /**
   * Parallel batched map — the same batching mechanic `research()` uses
   * (`chunk` + `Promise.all`), exposed for the Deep Research fan-out.
   */
  private async batchMap<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = [];
    for (const batch of this.chunk(items, Math.max(1, size))) {
      out.push(...(await Promise.all(batch.map(fn))));
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      promise.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        error => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  private buildFallbackReport(topic: string, results: ResearchWorkerResult[]): string {
    const successful = results.filter(r => r.success && r.output.trim().length > 0);
    if (successful.length === 0) {
      return `# ${topic}\n\nNo successful worker output was available before timeout.`;
    }

    const sections = successful
      .map(r => `## ${r.subtopic}\n\n${r.output}`)
      .join('\n\n---\n\n');

    return [
      `# Research Report (Fallback Synthesis): ${topic}`,
      '',
      'Aggregation timed out, returning concatenated worker outputs.',
      '',
      sections,
    ].join('\n');
  }
}

// ============================================================================
// Convenience function for tool use
// ============================================================================

export async function runWideResearch(
  topic: string,
  apiKey: string,
  options?: WideResearchOptions,
  providerConfig?: Record<string, unknown>
): Promise<ToolResult> {
  const orchestrator = new WideResearchOrchestrator(options);

  try {
    const result = await orchestrator.research(topic, apiKey, providerConfig);

    const summary = [
      `# Wide Research: ${topic}`,
      ``,
      `**Workers:** ${result.successCount}/${result.subtopics.length} succeeded`,
      `**Duration:** ${(result.durationMs / 1000).toFixed(1)}s`,
      ``,
      `## Subtopics Researched`,
      ...result.subtopics.map((s, i) => {
        const r = result.workerResults[i];
        return `- ${s} ${r?.success ? '✅' : '❌'}`;
      }),
      ``,
      `---`,
      ``,
      result.report,
    ].join('\n');

    return { success: true, output: summary };
  } catch (err) {
    return {
      success: false,
      error: `Wide Research failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Convenience wrapper for the opt-in Deep Research (Phase A) path, symmetric to
 * `runWideResearch`. Returns the cited report (already carrying inline [n]
 * markers and a "## Références" section). Never throws.
 */
export async function runDeepResearch(
  topic: string,
  apiKey: string,
  options?: WideResearchOptions & { deep?: DeepResearchLoopOptions },
  providerConfig?: Record<string, unknown>,
): Promise<ToolResult> {
  const orchestrator = new WideResearchOrchestrator(options);
  try {
    const result = await orchestrator.deepResearch(topic, apiKey, providerConfig, options?.deep);
    const summary = [
      `# Deep Research: ${topic}`,
      '',
      `**Sources:** ${result.sources.length} (deduped, ${result.duplicatesDropped} near-duplicate(s) dropped)`,
      `**Planner:** ${result.plannerLlmUsed ? 'LLM' : 'deterministic fallback'} | ` +
        `**Synthesis:** ${result.synthesisLlmUsed ? 'LLM' : 'deterministic fallback'}`,
      `**Duration:** ${(result.durationMs / 1000).toFixed(1)}s`,
      '',
      '---',
      '',
      result.report,
    ].join('\n');
    return { success: true, output: summary };
  } catch (err) {
    return {
      success: false,
      error: `Deep Research failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
