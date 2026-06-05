/**
 * `buddy improve` — drive the recursive self-improvement engine.
 *
 * The engine improves the agent's reversible learnable layer (lessons today)
 * only when a deterministic capability benchmark empirically improves with zero
 * regressions, snapshot/rollback always. It is propose-only by default; pass
 * `--apply` (or set CODEBUDDY_SELF_IMPROVE=true) to keep validated improvements.
 *
 * @module commands/cli/improve-command
 */

import type { Command } from 'commander';

import { createWorkspaceEngine } from '../../agent/self-improvement/index.js';
import { EvolutionaryArchive } from '../../agent/self-improvement/evolutionary-archive.js';
import { createDefaultRunExperienceSource } from '../../agent/self-improvement/experience-source.js';
import type { Experience } from '../../agent/self-improvement/types.js';

/**
 * Collect real run-friction experiences (best-effort) so the LLM proposer can
 * ground its drafts in what actually went wrong. Never throws — an empty list
 * just means the proposer relies on the scenario alone.
 */
async function collectExperiences(): Promise<Experience[]> {
  try {
    return await createDefaultRunExperienceSource({ limit: 10 }).collect();
  } catch {
    return [];
  }
}

interface ImproveOptions {
  json?: boolean;
  apply?: boolean;
  max?: string;
  llm?: boolean;
}

function print(payload: unknown, options: ImproveOptions, text: string): void {
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(text);
  }
}

export function registerImproveCommands(program: Command): void {
  const improve = program
    .command('improve')
    .description('Recursive self-improvement: empirically validate and apply reversible learning improvements');

  improve
    .command('status')
    .description('Show capability-benchmark coverage, autonomy mode, and the improvement archive')
    .option('--json', 'output JSON')
    .action((options: ImproveOptions) => {
      const engine = createWorkspaceEngine();
      const status = engine.status();
      const text = [
        `Autonomy: ${status.autonomy}`,
        `Capability coverage: ${status.score.covered}/${status.score.total} (${Math.round(status.score.ratio * 100)}%)`,
        `Uncovered: ${status.score.results.filter((r) => !r.covered).map((r) => r.scenarioId).join(', ') || '(none)'}`,
        `Archive: ${status.archive.count} validated improvement(s), total Δ=${status.archive.totalDelta}`,
      ].join('\n');
      print({ kind: 'self_improvement_status', ...status }, options, text);
    });

  improve
    .command('cycle')
    .description('Run one improvement cycle (propose → empirically validate → keep/rollback)')
    .option('--json', 'output JSON')
    .option('--apply', 'keep empirically-validated improvements (overrides propose-only for this run)')
    .option('--llm', 'use the model to discover novel lessons from run friction (else a deterministic seed pack)')
    .action(async (options: ImproveOptions) => {
      const engine = createWorkspaceEngine({
        ...(options.apply ? { autonomy: 'auto-apply' as const } : {}),
        useLlm: options.llm === true,
      });
      const experiences = options.llm ? await collectExperiences() : [];
      const result = await engine.runCycle(experiences);
      const verdict = result.applied
        ? `APPLIED improvement to "${result.selectedScenarioId}" (Δ=${result.gate?.delta})`
        : result.gate?.accepted
          ? `WOULD improve "${result.selectedScenarioId}" (Δ=${result.gate?.delta}) — re-run with --apply to keep`
          : result.selectedScenarioId
            ? `No improvement kept for "${result.selectedScenarioId}": ${result.notes.join('; ')}`
            : result.notes.join('; ');
      const text = [
        `Autonomy: ${result.autonomy}`,
        `Coverage: ${result.scoreBefore.covered}/${result.scoreBefore.total} → ${result.scoreAfter.covered}/${result.scoreAfter.total}`,
        verdict,
      ].join('\n');
      print(result, options, text);
    });

  improve
    .command('loop')
    .description('Run improvement cycles until no further validated progress is made')
    .option('--json', 'output JSON')
    .option('--apply', 'keep empirically-validated improvements (overrides propose-only for this run)')
    .option('--max <n>', 'maximum cycles', (v) => v)
    .option('--llm', 'use the model to discover novel lessons from run friction (else a deterministic seed pack)')
    .action(async (options: ImproveOptions) => {
      const engine = createWorkspaceEngine({
        ...(options.apply ? { autonomy: 'auto-apply' as const } : {}),
        useLlm: options.llm === true,
      });
      const maxCycles = options.max ? Number.parseInt(options.max, 10) : undefined;
      const experiences = options.llm ? await collectExperiences() : [];
      const results = await engine.runLoop({ ...(maxCycles ? { maxCycles } : {}), experiences });
      const appliedCount = results.filter((r) => r.applied).length;
      const final = engine.status();
      const text = [
        `Autonomy: ${results[0]?.autonomy ?? 'propose-only'}`,
        `Cycles: ${results.length}, applied: ${appliedCount}`,
        `Final coverage: ${final.score.covered}/${final.score.total} (${Math.round(final.score.ratio * 100)}%)`,
      ].join('\n');
      print({ kind: 'self_improvement_loop', cycles: results, status: final }, options, text);
    });

  improve
    .command('archive')
    .description('List empirically-validated improvements kept by the engine')
    .option('--json', 'output JSON')
    .action((options: ImproveOptions) => {
      const engine = createWorkspaceEngine();
      const entries = new EvolutionaryArchive().list();
      const text = entries.length
        ? entries
            .map((e: { targetScenarioId: string; delta: number; createdAt: string }) =>
              `${e.createdAt}  ${e.targetScenarioId}  Δ=${e.delta}`,
            )
            .join('\n')
        : 'No validated improvements archived yet.';
      print({ kind: 'self_improvement_archive', entries, status: engine.status() }, options, text);
    });
}
