/**
 * Insights Command
 *
 * Surfaces analytics that Code Buddy already collects — token usage, cost
 * tracking, tool-usage patterns, and recent agent activity — through a single
 * `buddy insights` CLI surface (parity with `hermes insights`).
 *
 * This command is a *read-only aggregator*: it does not introduce a new
 * analytics pipeline. It reads from the existing singletons:
 *   - CostTracker  (`src/utils/cost-tracker.ts`)   — token/cost ledger
 *   - ToolAnalytics(`src/analytics/tool-analytics.ts`) — tool usage snapshot
 *   - RunStore     (`src/observability/run-store.ts`)  — agent run activity
 *
 * Usage:
 *   buddy insights [summary]   Aggregated token/cost/activity overview
 *   buddy insights cost        Cost & token breakdown
 *   buddy insights tools       Tool usage analytics
 *
 * Each subcommand accepts `--json` for machine-readable output.
 */

import type { Command, OptionValues } from 'commander';
import { logger } from '../../utils/logger.js';
import { getCostTracker, type CostReport } from '../../utils/cost-tracker.js';
import {
  getToolAnalytics,
  type ToolAnalyticsSnapshot,
} from '../../analytics/tool-analytics.js';
import { RunStore } from '../../observability/run-store.js';

// ============================================================================
// Data shapes (JSON output is stable for UI consumers)
// ============================================================================

interface CostInsights {
  sessionCost: number;
  dailyCost: number;
  weeklyCost: number;
  monthlyCost: number;
  totalCost: number;
  sessionTokens: { input: number; output: number };
  modelBreakdown: Record<string, { cost: number; calls: number }>;
}

interface ToolInsights {
  totalExecutions: number;
  uniqueTools: number;
  overallSuccessRate: number;
  mostUsedTools: Array<{ name: string; count: number }>;
  highestSuccessRate: Array<{ name: string; rate: number }>;
  lowestSuccessRate: Array<{ name: string; rate: number }>;
}

interface ActivityInsights {
  totalRuns: number;
  byStatus: Record<string, number>;
  totalTokens: number;
  totalToolCalls: number;
  recentRuns: Array<{
    runId: string;
    objective: string;
    status: string;
    startedAt: number;
    totalTokens: number;
    toolCallCount: number;
  }>;
}

interface InsightsSummary {
  generatedAt: string;
  schemaVersion: number;
  cost: CostInsights;
  tools: ToolInsights;
  activity: ActivityInsights;
}

const SCHEMA_VERSION = 1;
const RECENT_RUN_LIMIT = 5;
const ACTIVITY_SCAN_LIMIT = 50;

// ============================================================================
// Collectors — reuse the existing analytics modules, never reimplement them
// ============================================================================

function collectCostInsights(): CostInsights {
  let report: CostReport;
  try {
    report = getCostTracker().getReport();
  } catch (error) {
    logger.warn(`insights: failed to read cost report: ${String(error)}`);
    return {
      sessionCost: 0,
      dailyCost: 0,
      weeklyCost: 0,
      monthlyCost: 0,
      totalCost: 0,
      sessionTokens: { input: 0, output: 0 },
      modelBreakdown: {},
    };
  }

  return {
    sessionCost: report.sessionCost,
    dailyCost: report.dailyCost,
    weeklyCost: report.weeklyCost,
    monthlyCost: report.monthlyCost,
    totalCost: report.totalCost,
    sessionTokens: {
      input: report.sessionTokens.input,
      output: report.sessionTokens.output,
    },
    modelBreakdown: report.modelBreakdown,
  };
}

function collectToolInsights(): ToolInsights {
  let snapshot: ToolAnalyticsSnapshot;
  try {
    snapshot = getToolAnalytics().getSnapshot();
  } catch (error) {
    logger.warn(`insights: failed to read tool analytics: ${String(error)}`);
    return {
      totalExecutions: 0,
      uniqueTools: 0,
      overallSuccessRate: 0,
      mostUsedTools: [],
      highestSuccessRate: [],
      lowestSuccessRate: [],
    };
  }

  return {
    totalExecutions: snapshot.totalExecutions,
    uniqueTools: snapshot.uniqueTools,
    overallSuccessRate: snapshot.overallSuccessRate,
    mostUsedTools: snapshot.mostUsedTools,
    highestSuccessRate: snapshot.highestSuccessRate,
    lowestSuccessRate: snapshot.lowestSuccessRate,
  };
}

function collectActivityInsights(): ActivityInsights {
  const byStatus: Record<string, number> = {};
  const recentRuns: ActivityInsights['recentRuns'] = [];
  let totalTokens = 0;
  let totalToolCalls = 0;
  let totalRuns = 0;

  try {
    const store = RunStore.getInstance();
    const summaries = store.listRuns(ACTIVITY_SCAN_LIMIT);
    totalRuns = summaries.length;

    for (const summary of summaries) {
      byStatus[summary.status] = (byStatus[summary.status] ?? 0) + 1;
    }

    for (let i = 0; i < Math.min(summaries.length, RECENT_RUN_LIMIT); i++) {
      const summary = summaries[i];
      if (!summary) continue;
      const record = store.getRun(summary.runId);
      const metrics = record?.metrics ?? {};
      const runTokens = metrics.totalTokens ?? 0;
      const runToolCalls = metrics.toolCallCount ?? 0;
      totalTokens += runTokens;
      totalToolCalls += runToolCalls;
      recentRuns.push({
        runId: summary.runId,
        objective: summary.objective,
        status: summary.status,
        startedAt: summary.startedAt,
        totalTokens: runTokens,
        toolCallCount: runToolCalls,
      });
    }
  } catch (error) {
    logger.warn(`insights: failed to read run activity: ${String(error)}`);
  }

  return { totalRuns, byStatus, totalTokens, totalToolCalls, recentRuns };
}

function buildSummary(): InsightsSummary {
  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    cost: collectCostInsights(),
    tools: collectToolInsights(),
    activity: collectActivityInsights(),
  };
}

// ============================================================================
// Human-readable renderers
// ============================================================================

function fmtUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function renderCost(cost: CostInsights): string[] {
  const lines: string[] = [];
  lines.push('Cost & Tokens');
  lines.push('-'.repeat(40));
  lines.push(`  Session : ${fmtUsd(cost.sessionCost)}`);
  lines.push(`  Today   : ${fmtUsd(cost.dailyCost)}`);
  lines.push(`  Week    : ${fmtUsd(cost.weeklyCost)}`);
  lines.push(`  Month   : ${fmtUsd(cost.monthlyCost)}`);
  lines.push(`  All time: ${fmtUsd(cost.totalCost)}`);
  lines.push(
    `  Session tokens: ${cost.sessionTokens.input.toLocaleString()} in / ${cost.sessionTokens.output.toLocaleString()} out`,
  );
  const models = Object.entries(cost.modelBreakdown);
  if (models.length > 0) {
    lines.push('  By model:');
    for (const [model, stats] of models) {
      lines.push(`    ${model}: ${fmtUsd(stats.cost)} (${stats.calls} call${stats.calls === 1 ? '' : 's'})`);
    }
  }
  return lines;
}

function renderTools(tools: ToolInsights): string[] {
  const lines: string[] = [];
  lines.push('Tool Usage');
  lines.push('-'.repeat(40));
  lines.push(`  Total executions: ${tools.totalExecutions.toLocaleString()}`);
  lines.push(`  Unique tools    : ${tools.uniqueTools}`);
  lines.push(`  Success rate    : ${tools.overallSuccessRate.toFixed(1)}%`);
  if (tools.mostUsedTools.length > 0) {
    lines.push('  Most used:');
    for (const tool of tools.mostUsedTools) {
      lines.push(`    ${tool.name}: ${tool.count}`);
    }
  }
  if (tools.lowestSuccessRate.length > 0) {
    lines.push('  Needs attention (min 5 uses):');
    for (const tool of tools.lowestSuccessRate) {
      lines.push(`    ${tool.name}: ${tool.rate.toFixed(1)}%`);
    }
  }
  return lines;
}

function renderActivity(activity: ActivityInsights): string[] {
  const lines: string[] = [];
  lines.push('Agent Activity');
  lines.push('-'.repeat(40));
  lines.push(`  Recent runs : ${activity.totalRuns}`);
  const statuses = Object.entries(activity.byStatus);
  if (statuses.length > 0) {
    lines.push(`  By status   : ${statuses.map(([s, n]) => `${s}=${n}`).join(', ')}`);
  }
  lines.push(`  Tokens (last ${RECENT_RUN_LIMIT}) : ${activity.totalTokens.toLocaleString()}`);
  lines.push(`  Tool calls (last ${RECENT_RUN_LIMIT}): ${activity.totalToolCalls.toLocaleString()}`);
  if (activity.recentRuns.length > 0) {
    lines.push('  Latest:');
    for (const run of activity.recentRuns) {
      const when = new Date(run.startedAt).toISOString();
      lines.push(`    [${run.status}] ${run.objective} (${run.runId}, ${when})`);
    }
  }
  return lines;
}

function printSummaryHuman(summary: InsightsSummary): void {
  const lines: string[] = [];
  lines.push('');
  lines.push('Code Buddy Insights');
  lines.push('='.repeat(40));
  lines.push('');
  lines.push(...renderCost(summary.cost));
  lines.push('');
  lines.push(...renderTools(summary.tools));
  lines.push('');
  lines.push(...renderActivity(summary.activity));
  // Single emit keeps human mode tidy; JSON mode emits its own single blob.
  console.log(lines.join('\n'));
}

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Resolve the `--json` flag whether it was parsed on the subcommand or on the
 * parent `insights` command. Because the parent also declares `--json`,
 * Commander binds a trailing `--json` to the parent scope, so subcommands must
 * read `optsWithGlobals()` to see it reliably.
 */
function wantsJson(command: Command): boolean {
  const opts: OptionValues = command.optsWithGlobals();
  return opts.json === true;
}

export function registerInsightsCommands(program: Command): void {
  const insights = program
    .command('insights')
    .description('Token, cost, and activity analytics (read-only)')
    .option('--json', 'Output machine-readable JSON')
    .action((_options: OptionValues, command: Command) => {
      const summary = buildSummary();
      if (wantsJson(command)) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }
      printSummaryHuman(summary);
    });

  insights
    .command('summary')
    .description('Aggregated token/cost/activity overview (default)')
    .option('--json', 'Output machine-readable JSON')
    .action((_options: OptionValues, command: Command) => {
      const summary = buildSummary();
      if (wantsJson(command)) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }
      printSummaryHuman(summary);
    });

  insights
    .command('cost')
    .description('Cost and token breakdown')
    .option('--json', 'Output machine-readable JSON')
    .action((_options: OptionValues, command: Command) => {
      const cost = collectCostInsights();
      if (wantsJson(command)) {
        console.log(
          JSON.stringify(
            { generatedAt: new Date().toISOString(), schemaVersion: SCHEMA_VERSION, cost },
            null,
            2,
          ),
        );
        return;
      }
      console.log(['', ...renderCost(cost)].join('\n'));
    });

  insights
    .command('tools')
    .description('Tool usage analytics')
    .option('--json', 'Output machine-readable JSON')
    .action((_options: OptionValues, command: Command) => {
      const tools = collectToolInsights();
      if (wantsJson(command)) {
        console.log(
          JSON.stringify(
            { generatedAt: new Date().toISOString(), schemaVersion: SCHEMA_VERSION, tools },
            null,
            2,
          ),
        );
        return;
      }
      console.log(['', ...renderTools(tools)].join('\n'));
    });
}
