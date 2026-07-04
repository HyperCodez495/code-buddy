/**
 * `buddy science` — AI-Scientist-lite Phase 0 CLI.
 *
 * Runs ONE bounded, human-gated research/experiment pass by composing existing
 * Code Buddy faculties (see {@link module:agent/science/experiment-orchestrator}).
 * It EXECUTES generated code, so it is defensive by construction:
 *
 *   - OPT-IN: requires `CODEBUDDY_AI_SCIENTIST=true` (default OFF ⇒ prints an
 *     opt-in notice and does nothing — zero behaviour change).
 *   - CLI-ONLY: this is NOT an agent tool. The agent can never launch an
 *     experiment mid-chat; a human must run this command.
 *   - TWO human gates (approve the plan before running code; approve the report
 *     before publishing to the collective knowledge graph) — both FAIL CLOSED.
 *   - SANDBOXED execution (envMode:'isolate') is enforced by the orchestrator.
 *
 * Usage:
 *   CODEBUDDY_AI_SCIENTIST=true buddy science "does focal loss beat CE on toy imbalance?"
 *   CODEBUDDY_AI_SCIENTIST=true buddy science "..." --hypothesis "focal loss ↑ minority recall" --report out.md
 *   CODEBUDDY_AI_SCIENTIST=true buddy science "..." --code-file experiment.py --language python
 *
 * @module commands/science
 */

import { Command } from 'commander';
import { writeFile } from 'fs/promises';
import { logger } from '../../utils/logger.js';
import { runExperiment, type ExperimentRun } from '../../agent/science/experiment-orchestrator.js';
import type { ExecuteCodeLanguage } from '../../tools/execute-code-runner.js';

const VALID_LANGUAGES: ExecuteCodeLanguage[] = ['python', 'javascript', 'typescript', 'shell'];

interface ScienceCliOptions {
  hypothesis?: string;
  codeFile?: string;
  language?: string;
  model?: string;
  timeout?: string;
  report?: string;
  /** Commander sets this false when --no-publish is passed. */
  publish?: boolean;
  /** Phase 1: empirically score + keep-gate the experiment metric. */
  score?: boolean;
  metricKey?: string;
  baselineScore?: string;
  /** Commander sets this false when --lower-is-better is passed. */
  higherIsBetter?: boolean;
}

/** Human-readable one-pass summary. */
function renderRun(run: ExperimentRun): string {
  const lines: string[] = [];
  lines.push(`\n=== AI-Scientist Phase 0 — ${run.status.toUpperCase()} ===\n`);
  if (run.idea) lines.push(`Hypothèse [${run.idea.source}]: ${run.idea.hypothesis}`);
  if (run.novelty) lines.push(`Nouveauté: ${run.novelty.noveltyAssessment} — ${run.novelty.summary}`);
  lines.push('');
  lines.push('Étapes:');
  for (const s of run.stages) {
    lines.push(`  ${s.ok ? '✓' : '✗'} ${s.stage.padEnd(12)} ${s.detail}`);
  }
  if (run.review) lines.push(`\nRevue: ${run.review.verdict}`);
  if (run.empirical) {
    const e = run.empirical;
    lines.push(
      `\nEmpirique: fitness ${e.fitness.score.toFixed(3)} · décision ${e.decision.keep ? 'keep' : 'reject'} (${e.decision.reason}) · gardé=${e.kept}`,
    );
    if (e.variantId) lines.push(`  variant archivé: ${e.variantId}`);
  }
  if (run.error) lines.push(`\nErreur: ${run.error}`);
  return lines.join('\n');
}

export function createScienceCommand(): Command {
  const cmd = new Command('science')
    .description(
      'AI-Scientist-lite (Phase 0, EXPERIMENTAL): run ONE human-gated, sandboxed experiment pass (idea → novelty → GATE → run → analyse → report → review → GATE → publish)',
    )
    .argument('<goal>', 'The research goal / question to experiment on')
    .option('--hypothesis <text>', 'Supply the hypothesis directly (skips LLM ideation)')
    .option('--code-file <path>', 'Supply the experiment code from a file (skips LLM authoring)')
    .option('--language <lang>', `Experiment language: ${VALID_LANGUAGES.join('|')}`, 'python')
    .option('-m, --model <model>', 'Override the model for this run')
    .option('--timeout <ms>', 'Experiment execution timeout in ms (clamped to the runner cap)')
    .option('-r, --report <file>', 'Write the final Markdown report to a file')
    .option('--no-publish', 'Never publish (still runs + reviews; GATE #2 auto-declines)')
    .option('--score', 'Phase 1: empirically score the experiment metric, record a variant, human keep-gate it (decoupled from the repo)')
    .option('--metric-key <key>', 'Metric key to parse from the experiment stdout (with --score)', 'accuracy')
    .option('--baseline-score <n>', 'Experiment baseline score to beat (with --score); omit to keep the first stepping-stone')
    .option('--no-higher-is-better', 'Treat the metric as lower-is-better, e.g. a loss (with --score)')
    .action(async (goal: string, opts: ScienceCliOptions) => {
      // ── OPT-IN gate (default OFF = zero behaviour change) ─────────────────
      if (process.env.CODEBUDDY_AI_SCIENTIST !== 'true') {
        logger.error(
          'AI-Scientist is an EXPERIMENTAL, opt-in feature that EXECUTES generated code in a sandbox.\n' +
            'It is off by default. Enable it explicitly for this session:\n\n' +
            '  CODEBUDDY_AI_SCIENTIST=true buddy science "<goal>"\n\n' +
            'It will ask you to approve the plan BEFORE running code and the report BEFORE publishing.',
        );
        process.exitCode = 1;
        return;
      }

      const language = (opts.language ?? 'python').toLowerCase();
      if (!VALID_LANGUAGES.includes(language as ExecuteCodeLanguage)) {
        logger.error(`Invalid --language "${language}". Use one of: ${VALID_LANGUAGES.join(', ')}.`);
        process.exitCode = 1;
        return;
      }

      const { resolveCommandProvider } = await import('../llm-provider-resolution.js');
      const provider = resolveCommandProvider(opts.model ? { explicitModel: opts.model } : {});
      if (!provider) {
        logger.error(
          'No LLM provider available — set an API key, run `buddy login`, or point CODEBUDDY_PROVIDER=ollama at a local Ollama.',
        );
        process.exitCode = 1;
        return;
      }

      const timeoutMs = opts.timeout ? Number(opts.timeout) : undefined;
      const { buildScienceDeps, buildEmpiricalScoringConfig } = await import('./deps.js');
      const deps = buildScienceDeps({
        provider,
        language: language as ExecuteCodeLanguage,
        ...(opts.hypothesis ? { hypothesis: opts.hypothesis } : {}),
        ...(opts.codeFile ? { codeFile: opts.codeFile } : {}),
        ...(opts.publish === false ? { noPublish: true } : {}),
      });

      // ── Phase 1 (OPT-IN via --score): empirical scoring / keep-gate ────────
      const baselineScore = opts.baselineScore !== undefined ? Number(opts.baselineScore) : undefined;
      if (opts.baselineScore !== undefined && !Number.isFinite(baselineScore)) {
        logger.error(`Invalid --baseline-score "${opts.baselineScore}" (must be a number).`);
        process.exitCode = 1;
        return;
      }
      const empirical = opts.score
        ? buildEmpiricalScoringConfig({
            metricKey: opts.metricKey ?? 'accuracy',
            higherIsBetter: opts.higherIsBetter !== false,
            ...(baselineScore !== undefined && Number.isFinite(baselineScore) ? { baselineScore } : {}),
          })
        : undefined;

      logger.info(`AI-Scientist Phase ${empirical ? '1' : '0'} — goal: ${goal}`);
      logger.info('Two human gates will ask for your approval (plan, then publication). Both fail closed.');
      if (empirical) logger.info('A third keep-gate will ask before an experiment variant is kept. It also fails closed.');
      logger.info('');

      const run = await runExperiment(goal, deps, {
        ...(timeoutMs && Number.isFinite(timeoutMs) ? { experimentTimeoutMs: timeoutMs } : {}),
        ...(empirical ? { empirical } : {}),
        onStage: (s) => logger.info(`  [${s.ok ? 'ok' : '..'}] ${s.stage}: ${s.detail}`),
      });

      logger.info(renderRun(run));

      if (run.report && opts.report) {
        try {
          await writeFile(opts.report, run.report.report, 'utf8');
          logger.info(`\nRapport écrit → ${opts.report}`);
        } catch (err) {
          logger.error(`Impossible d'écrire le rapport: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else if (run.report && !opts.report) {
        // Print the report to stdout so it is capturable without a file.
        console.log(`\n${run.report.report}`);
      }

      if (run.status === 'failed') process.exitCode = 1;
    });

  return cmd;
}
