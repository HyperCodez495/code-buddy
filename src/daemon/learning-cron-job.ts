/**
 * Self-hosted 24/7 learning loop (S6).
 *
 * Registers a cron `script` job that runs `buddy improve cycle --apply` on a
 * fixed interval inside the long-running daemon. The job is a bounded,
 * allowlisted SUBPROCESS (no agent, no provider call at the cron layer): it
 * re-enters the CLI in its own process, so a crash in a cycle cannot take down
 * the daemon. This is the "cloud" the user asked for — a daemon on this machine,
 * no Modal/Daytona/subscription.
 *
 * Gated by `CODEBUDDY_LEARNING_DAEMON` (OFF by default). The cycle's autonomy
 * (propose-only vs auto-apply) is controlled by `CODEBUDDY_SELF_IMPROVE` inside
 * the spawned process, exactly as `buddy improve cycle` already honours it.
 *
 * @module daemon/learning-cron-job
 */

import path from 'path';
import { CronScheduler, getCronScheduler, type CronJob } from '../scheduler/cron-scheduler.js';
import { logger } from '../utils/logger.js';

/** Stable job name used for idempotent registration across daemon restarts. */
export const LEARNING_CRON_JOB_NAME = 'codebuddy-learning-cycle';

/** Default cadence: once per hour. */
export const DEFAULT_LEARNING_INTERVAL_MS = 60 * 60 * 1000;

/** Floor cadence to avoid hammering: 5 minutes. */
const MIN_LEARNING_INTERVAL_MS = 5 * 60 * 1000;

const TRUTHY = new Set(['1', 'true', 'on', 'yes', 'enabled']);

/** Whether the 24/7 learning daemon job is opted in. */
export function isLearningDaemonEnabled(): boolean {
  return TRUTHY.has((process.env.CODEBUDDY_LEARNING_DAEMON ?? '').trim().toLowerCase());
}

/** Resolve the cycle interval from env, clamped to the floor. */
export function resolveLearningIntervalMs(): number {
  const raw = (process.env.CODEBUDDY_LEARNING_DAEMON_INTERVAL_MS ?? '').trim();
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LEARNING_INTERVAL_MS;
  return Math.max(MIN_LEARNING_INTERVAL_MS, value);
}

export interface RegisterLearningCronJobOptions {
  /** Scheduler to register on. Defaults to the shared singleton. */
  scheduler?: CronScheduler;
  /** node executable. Defaults to the running process's node. */
  nodeExecutable?: string;
  /** CLI entry script. Defaults to process.argv[1] (the buddy CLI). */
  cliEntry?: string;
  /** Interval override (ms). Defaults to resolveLearningIntervalMs(). */
  intervalMs?: number;
}

/**
 * Idempotently register the learning-cycle cron job. Returns the existing job
 * if one is already registered (so a daemon restart does not duplicate it).
 */
export async function registerLearningCronJob(
  options: RegisterLearningCronJobOptions = {},
): Promise<CronJob> {
  const scheduler = options.scheduler ?? getCronScheduler();
  await scheduler.loadFromDisk().catch(() => {});

  const existing = scheduler.listJobs().find((job) => job.name === LEARNING_CRON_JOB_NAME);
  if (existing) {
    logger.debug('[learning-daemon] learning cron job already registered', { id: existing.id });
    return existing;
  }

  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const cliEntry = options.cliEntry ?? process.argv[1] ?? path.resolve(process.cwd(), 'dist', 'index.js');
  const intervalMs = options.intervalMs ?? resolveLearningIntervalMs();

  const job = await scheduler.addJob({
    name: LEARNING_CRON_JOB_NAME,
    description: 'Hermes-style self-improvement cycle (buddy improve cycle --apply)',
    type: 'every',
    schedule: { every: intervalMs },
    task: {
      type: 'script',
      command: {
        executable: nodeExecutable,
        args: [cliEntry, 'improve', 'cycle', '--apply'],
        allowedExecutables: [path.basename(nodeExecutable)],
        timeoutMs: 600_000,
      },
    },
    // Silent: this is a background maintenance loop, not a user notification.
    delivery: { mode: 'none' },
  });

  logger.info('[learning-daemon] registered self-improvement cron job', {
    id: job.id,
    intervalMs,
  });
  return job;
}
