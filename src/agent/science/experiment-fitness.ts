/**
 * AI-Scientist-lite — Phase 1: the experiment fitness component.
 *
 * This is the GENERALISED empirical gate's measurement brick. It reuses the DGM
 * `FitnessComponent` abstraction (`variant-fitness.ts`) but is DELIBERATELY
 * DECOUPLED from the Code Buddy repo:
 *
 *   - It scores THE METRIC OF AN EXPERIMENT, parsed from that experiment's own
 *     output (stdout / result.json), NOT the repo's typecheck or vitest.
 *   - It runs the experiment code in the EXPERIMENT FOLDER (`ctx.checkoutDir` —
 *     the throwaway sandbox run dir), NEVER against `src/` or `main`.
 *   - Execution goes through an INJECTED runner boundary, which the orchestrator
 *     always drives with `envMode:'isolate'` (env scrub, redirected HOME,
 *     throwaway cwd). The component itself sets `envMode:'isolate'` too, so it
 *     cannot be talked out of the sandbox.
 *
 * The metric PARSER is a boundary as well: the core ships a stdout number parser,
 * the CLI can inject a richer one (e.g. reading result.json). never-throws: a
 * failing execution or an unparsable metric degrades to a FLOOR score (0) with a
 * reason, never an exception.
 *
 * @module agent/science/experiment-fitness
 */

import type {
  ExecuteCodeInput,
  ExecuteCodeLanguage,
  ExecuteCodeResult,
  ExecuteCodeRunnerOptions,
} from '../../tools/execute-code-runner.js';
import type { ComponentResult, FitnessComponent, FitnessContext } from '../self-improvement/evolution/variant-fitness.js';

/** The sandbox mode the component ALWAYS enforces on its execution boundary. */
const SANDBOX_ENV_MODE: NonNullable<ExecuteCodeRunnerOptions['envMode']> = 'isolate';

/** A parsed experiment metric: the raw value + its normalisation to [0,1]. */
export interface ExperimentMetric {
  /** Metric name (e.g. 'accuracy', 'minority_recall'). */
  name: string;
  /** Raw parsed value, or null when the metric could not be found in the output. */
  value: number | null;
  /** Normalised score in [0,1] (0 when not found / execution failed). */
  score: number;
  /** Human-readable explanation of how the score was derived. */
  detail: string;
  /**
   * True when the raw value was OUTSIDE [0,1] with no explicit `{min,max}` range,
   * so its normalisation is untrustworthy (e.g. a percentage 87.5 that would
   * otherwise clamp to a false "perfect" 1.0). The fitness component treats such
   * a metric as NOT passed so the corruption is visible, not silently kept.
   */
  outOfRange?: boolean;
}

/**
 * Turn an experiment's execution output into a normalised metric. INJECTABLE:
 * the core provides {@link stdoutNumberMetric}; the CLI can supply a parser that
 * also reads `result.json`. MUST NOT throw (the component guards it anyway).
 */
export type MetricParser = (exec: ExecuteCodeResult) => ExperimentMetric;

/**
 * Execute experiment code. Same shape as the real `execute-code-runner`; the
 * component always passes `envMode:'isolate'` + the experiment folder as
 * `rootDir`. INJECTABLE so tests supply a fake and the orchestrator can supply a
 * runner that returns an already-captured result (no double execution).
 */
export type ExperimentRunner = (
  input: ExecuteCodeInput,
  options: ExecuteCodeRunnerOptions,
) => Promise<ExecuteCodeResult>;

export interface ExperimentFitnessConfig {
  /** The experiment program (authored/supplied upstream — Phase 0). */
  code: string;
  language: ExecuteCodeLanguage;
  /** Sandbox execution boundary (isolate is enforced by the component). */
  executeCode: ExperimentRunner;
  /** Metric extraction boundary. */
  parseMetric: MetricParser;
  /** Component name (default 'experiment-metric'). */
  name?: string;
  /** Aggregation weight (default 1). */
  weight?: number;
  /** Per-execution timeout (ms); falls back to the fitness context's timeout. */
  timeoutMs?: number;
}

/** Clamp a number into [0,1] (NaN/Infinity → 0). */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Default stdout metric parser: finds `key=<number>` / `key: <number>` (last
 * occurrence wins — the final printed measurement). Normalisation:
 *   - `higherIsBetter` (default): the value is treated as already in [0,1] (an
 *     accuracy/recall), clamped. Pass an explicit `{ min, max }` to rescale.
 *   - `lowerIsBetter`: score = 1 − normalised(value) (a loss/error), needs a
 *     `{ min, max }` range to be meaningful.
 *
 * GUARD (see {@link ExperimentMetric.outOfRange}): without a `{min,max}` range the
 * parser assumes the value is already normalised to [0,1]. A raw value OUTSIDE
 * [0,1] (e.g. a percentage `accuracy=87.5`) would otherwise be SILENTLY clamped to
 * a false "perfect" 1.0, corrupting keep/archive/loop decisions. Rather than
 * clamp silently, such a value floors the score to 0 and is FLAGGED `outOfRange`
 * with an actionable detail (supply `--min/--max` or print a normalised value).
 *
 * Pure + never-throws. A richer parser (result.json) is a CLI/deps concern.
 */
export function stdoutNumberMetric(
  key: string,
  opts: { higherIsBetter?: boolean; min?: number; max?: number } = {},
): MetricParser {
  const higherIsBetter = opts.higherIsBetter !== false;
  return (exec: ExecuteCodeResult): ExperimentMetric => {
    const out = `${exec.stdout ?? ''}`;
    // Escape the key for the regex, allow `=` or `:` and optional whitespace.
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)`, 'gi');
    let match: RegExpExecArray | null;
    let last: number | null = null;
    while ((match = re.exec(out)) !== null) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed)) last = parsed;
    }
    if (last === null) {
      return { name: key, value: null, score: 0, detail: `métrique '${key}' absente de stdout` };
    }
    const { min, max } = opts;
    const hasRange = typeof min === 'number' && typeof max === 'number' && max > min;
    if (!hasRange && (last < 0 || last > 1)) {
      // No range + out of [0,1] ⇒ the value is NOT a normalised metric. Do not
      // clamp silently to a false 1.0 (or 0.0) — floor + flag so the corruption
      // is visible to the keep-gate / archive / loop instead of "always perfect".
      return {
        name: key,
        value: last,
        score: 0,
        outOfRange: true,
        detail:
          `métrique '${key}'=${last} hors de [0,1] sans échelle : fournis --min/--max ` +
          `ou imprime une valeur normalisée (score non fiable, ignoré)`,
      };
    }
    const normalised = hasRange ? (last - (min as number)) / ((max as number) - (min as number)) : last;
    const score = clamp01(higherIsBetter ? normalised : 1 - normalised);
    return {
      name: key,
      value: last,
      score,
      detail: `${key}=${last} → score ${score.toFixed(3)} (${higherIsBetter ? 'higher' : 'lower'} is better)`,
    };
  };
}

/**
 * Build a {@link FitnessComponent} that measures an EXPERIMENT's metric.
 *
 * `run(ctx)` executes the experiment code through the injected runner in the
 * EXPERIMENT FOLDER (`ctx.checkoutDir`) under `envMode:'isolate'`, then parses
 * the target metric. never-throws: any failure floors the score to 0 with a
 * reason. It NEVER runs the repo's tests/typecheck — it only ever touches the
 * experiment folder handed to it.
 */
export function experimentFitnessComponent(config: ExperimentFitnessConfig): FitnessComponent {
  const name = config.name ?? 'experiment-metric';
  const weight = config.weight ?? 1;
  return {
    name,
    weight,
    // Experiment metrics are reproducible by contract (deterministic scripts).
    deterministic: true,
    async run(ctx: FitnessContext): Promise<ComponentResult> {
      const input: ExecuteCodeInput = {
        code: config.code,
        language: config.language,
        ...(config.timeoutMs !== undefined
          ? { timeoutMs: config.timeoutMs }
          : ctx.timeoutMs !== undefined
            ? { timeoutMs: ctx.timeoutMs }
            : {}),
      };
      // SECURITY / DECOUPLING: isolate mode + the EXPERIMENT folder as rootDir.
      // rootDir is the experiment's own directory, never the Code Buddy repo.
      const options: ExecuteCodeRunnerOptions = {
        envMode: SANDBOX_ENV_MODE,
        rootDir: ctx.checkoutDir,
      };

      let exec: ExecuteCodeResult;
      try {
        exec = await config.executeCode(input, options);
      } catch (err) {
        return {
          name,
          weight,
          score: 0,
          passed: false,
          detail: `execution failed (floored): ${errMsg(err)}`,
        };
      }

      let metric: ExperimentMetric;
      try {
        metric = config.parseMetric(exec);
      } catch (err) {
        return {
          name,
          weight,
          score: 0,
          passed: false,
          detail: `metric parse failed (floored): ${errMsg(err)}`,
          metrics: { exitCode: exec.exitCode ?? -1 },
        };
      }

      // An out-of-range metric (raw value outside [0,1] with no scale) is NOT a
      // trustworthy pass — flooring the score alone is not enough, the gate must
      // see passed:false so a corrupt "perfect" variant is never kept.
      const passed =
        exec.ok === true &&
        exec.timedOut !== true &&
        metric.value !== null &&
        metric.outOfRange !== true;
      return {
        name,
        weight,
        score: clamp01(metric.score),
        passed,
        detail: metric.detail,
        metrics: {
          ...(metric.value !== null ? { value: metric.value } : {}),
          exitCode: exec.exitCode ?? -1,
        },
      };
    },
  };
}

/**
 * A runner that returns an ALREADY-captured execution result (no re-execution).
 * The orchestrator injects this so Phase 1 scoring reuses the Phase 0 run rather
 * than running the experiment code a second time — while the component still
 * drives the boundary with the experiment folder + isolate mode.
 */
export function cachedExecutionRunner(result: ExecuteCodeResult): ExperimentRunner {
  return async () => result;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
