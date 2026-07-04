/**
 * `buddy research --deep <topic>` — the opt-in Deep Research (Phase A) CLI path.
 *
 * Strictly additive: this runs ONLY when `--deep` is present (see
 * `maybeRunDeepResearch`). Without the flag the command's existing Wide/direct
 * research behaviour is byte-identical.
 *
 * The heavy lifting lives in `WideResearchOrchestrator.deepResearch` +
 * `agent/deep-research.ts`; this module only handles CLI presentation
 * (progress lines, report file / stdout). The orchestrator is injectable so the
 * routing and rendering are unit-testable without any network.
 *
 * @module commands/research/deep
 */

import * as fs from 'fs/promises';
import path from 'path';
import type { WideResearchOrchestrator, DeepResearchProgress } from '../../agent/wide-research.js';
import type { DeepResearchOptions, DeepResearchResult } from '../../agent/deep-research.js';

export interface DeepResearchCliOptions {
  deep?: boolean;
  report?: string;
  reportPath?: string;
  providerLabel?: string;
  deepOptions?: DeepResearchOptions;
}

/** Minimal orchestrator surface used by the CLI (keeps the injected fake tiny). */
export interface DeepOrchestratorLike {
  on(event: 'progress', listener: (e: DeepResearchProgress) => void): unknown;
  deepResearch(
    question: string,
    apiKey: string,
    providerConfig?: Record<string, unknown>,
    deepOptions?: DeepResearchOptions,
  ): Promise<DeepResearchResult>;
}

export interface DeepResearchCliIo {
  log?: (msg: string) => void;
  errorLog?: (msg: string) => void;
  makeOrchestrator?: () => DeepOrchestratorLike;
  writeFile?: (file: string, content: string) => Promise<void>;
}

/**
 * Strict gate: only runs the deep path (via `run`) when `--deep` is present.
 * Returns true when it handled the request. Kept dependency-injected so the
 * "flag absent ⇒ deep code never runs" invariant is directly testable.
 */
export async function maybeRunDeepResearch(
  opts: { deep?: boolean },
  run: () => Promise<void>,
): Promise<boolean> {
  if (!opts.deep) return false;
  await run();
  return true;
}

/**
 * Execute the Deep Research CLI flow: subscribe to progress, run the pipeline,
 * then print or persist the cited report. Never throws (errors are reported and
 * a failure report is written when a file target was requested).
 */
export async function runDeepResearchCli(
  topic: string,
  apiKey: string,
  providerConfig: { model?: string; baseURL?: string },
  opts: DeepResearchCliOptions,
  io: DeepResearchCliIo = {},
): Promise<void> {
  const log = io.log ?? ((m: string) => console.log(m));
  const errorLog = io.errorLog ?? ((m: string) => console.error(m));
  const writeFile = io.writeFile ?? (async (file: string, content: string) => {
    const outputPath = path.resolve(file);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, content, 'utf-8');
  });
  const reportPath = opts.reportPath ?? opts.report;

  let orchestrator: DeepOrchestratorLike;
  if (io.makeOrchestrator) {
    orchestrator = io.makeOrchestrator();
  } else {
    const { WideResearchOrchestrator } = await import('../../agent/wide-research.js');
    orchestrator = new WideResearchOrchestrator() as unknown as WideResearchOrchestrator;
  }

  orchestrator.on('progress', (e: DeepResearchProgress) => {
    if (e.type !== 'deep') return;
    switch (e.stage) {
      case 'planning':
        log('  🧭 Planning search queries...');
        break;
      case 'planned':
        log(`  📝 ${e.subQuestions} sub-question(s), ${e.queries} search queries (${e.llmUsed ? 'LLM' : 'fallback'})`);
        break;
      case 'collecting':
        log(`  🌐 Collecting up to ${e.urls} source(s)...`);
        break;
      case 'collected':
        log(`  📥 Scraped ${e.scraped} source(s)`);
        break;
      case 'deduped':
        log(`  🧹 ${e.kept} kept, ${e.dropped} near-duplicate(s) dropped`);
        break;
      case 'synthesizing':
        log('  🔗 Synthesizing cited report...');
        break;
      case 'done':
        log(`  ✅ Deep Research complete (${e.sources} cited source(s))`);
        break;
    }
  });

  try {
    const result = await orchestrator.deepResearch(topic, apiKey, providerConfig, opts.deepOptions);
    const content = buildDeepReportFile(topic, result, opts.providerLabel);

    if (reportPath) {
      await writeFile(reportPath, content);
      log(`\n📄 Report saved: ${reportPath}`);
    } else {
      log('\n' + result.report);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errorLog(`\n❌ Deep Research failed: ${message}`);
    if (reportPath) {
      const failure = [
        `# Deep Research: ${topic}`,
        '',
        `Generated: ${new Date().toISOString()}`,
        'Mode: deep',
        'Status: failed',
        '',
        `Error: ${message}`,
      ].join('\n');
      await writeFile(reportPath, failure).catch(() => undefined);
    }
  }
}

/** Assemble the metadata preface + the cited report body for file output. */
export function buildDeepReportFile(
  topic: string,
  result: DeepResearchResult,
  providerLabel?: string,
): string {
  return [
    `# Deep Research: ${topic}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    'Mode: deep',
    providerLabel ? `Provider: ${providerLabel}` : undefined,
    `Sources: ${result.sources.length} (${result.duplicatesDropped} near-duplicate(s) dropped)`,
    `Planner: ${result.plannerLlmUsed ? 'LLM' : 'deterministic'} | ` +
      `Synthesis: ${result.synthesisLlmUsed ? 'LLM' : 'deterministic'}`,
    `Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
    '',
    '---',
    '',
    result.report,
  ]
    .filter((l): l is string => l !== undefined)
    .join('\n');
}
