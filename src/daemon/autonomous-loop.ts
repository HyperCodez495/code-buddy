/**
 * Fleet autonomous loop — the execution layer that makes Code Buddy run
 * continuously and (by default) for free.
 *
 * One `tick()`:
 *   1. advertise presence (active),
 *   2. pick the next auto-claimable task (never `critical` — that needs Patrice),
 *   3. claim it,
 *   4. choose the model tier (LOCAL/$0 by default; escalate only on policy),
 *   5. run the injected executor,
 *   6. on success → complete + worklog; on failure → release + worklog (so the
 *      task is retryable, never stuck); always return presence to idle.
 *
 * Safety is structural:
 *   - `critical` tasks are excluded by {@link FleetColabStore.nextClaimable}.
 *   - a kill-switch (`enabled`) short-circuits the whole tick.
 *   - the executor is injected, so the loop logic is testable without real
 *     inference and the dangerous part (what actually runs) is swappable.
 *
 * The loop never pushes git itself — claiming is advisory; cross-machine
 * arbitration stays "first to push wins" per the fleet protocol.
 */

import {
  chooseAutonomousModel,
  type AutonomousModelChoice,
  type ModelTierConfig,
  type ModelTierPolicy,
} from '../agent/model-tier.js';
import { beginFleetWork, isFleetSaturated } from '../fleet/fleet-load.js';
import type {
  ColabTask,
  ColabWorklogFileChange,
  FleetColabStore,
} from '../fleet/colab-store.js';

export interface TaskExecutionResult {
  ok: boolean;
  summary: string;
  filesModified?: ColabWorklogFileChange[];
  elapsedSeconds?: number;
  error?: string;
}

export type TaskExecutor = (
  task: ColabTask,
  model: AutonomousModelChoice,
) => Promise<TaskExecutionResult>;

export interface AutonomousLoopConfig {
  store: FleetColabStore;
  tierConfig: ModelTierConfig;
  executor: TaskExecutor;
  policy?: ModelTierPolicy;
  /** Kill-switch — when it returns false the tick is a no-op. Default: always on. */
  enabled?: () => boolean;
}

export interface TickResult {
  outcome: 'disabled' | 'idle' | 'completed' | 'failed' | 'saturated';
  taskId?: string;
  taskTitle?: string;
  model?: AutonomousModelChoice;
  detail?: string;
}

export class FleetAutonomousLoop {
  private readonly store: FleetColabStore;
  private readonly tierConfig: ModelTierConfig;
  private readonly executor: TaskExecutor;
  private readonly policy: ModelTierPolicy;
  private readonly enabled: () => boolean;
  /**
   * Per-task consecutive-failure counts (in-memory, this run). Fed to
   * {@link chooseAutonomousModel} so a task that keeps failing on the cheap tier
   * escalates to a stronger model (policy `escalateAfterFailures`). Cleared on
   * success. Resets across process restarts — escalation is a within-run feature.
   */
  private readonly failures = new Map<string, number>();

  constructor(config: AutonomousLoopConfig) {
    this.store = config.store;
    this.tierConfig = config.tierConfig;
    this.executor = config.executor;
    this.policy = config.policy ?? {};
    this.enabled = config.enabled ?? (() => true);
  }

  /** Run a single autonomous tick. Never throws — failures are logged + reported. */
  async tick(): Promise<TickResult> {
    if (!this.enabled()) {
      return { outcome: 'disabled' };
    }

    // Saturation backpressure (fleet load balancing): when this peer is
    // at its configured capacity (CODEBUDDY_FLEET_MAX_CONCURRENCY), it
    // ABSTAINS from claiming. The colab queue is shared across machines,
    // so an idle peer's daemon wins the claim instead — utilization
    // spreads over the fleet without any new RPC. Opt-in: with no
    // configured capacity this never triggers.
    if (isFleetSaturated()) {
      this.store.updatePresence({ status: 'active' });
      return { outcome: 'saturated', detail: 'at capacity — leaving the queue to idle peers' };
    }

    this.store.updatePresence({ status: 'active' });

    const next = this.store.nextClaimable();
    if (!next) {
      this.store.updatePresence({ status: 'idle', currentTask: null });
      return { outcome: 'idle' };
    }

    // Claim. If another agent won the race between read and claim, treat it as
    // idle for this tick rather than crashing.
    let task: ColabTask;
    try {
      task = this.store.claim(next.id);
    } catch (err) {
      this.store.updatePresence({ status: 'idle', currentTask: null });
      return { outcome: 'idle', detail: err instanceof Error ? err.message : String(err) };
    }

    this.store.updatePresence({ status: 'active', currentTask: task.title });
    const failures = this.failures.get(task.id) ?? 0;
    const model = chooseAutonomousModel(
      this.tierConfig,
      { priority: task.priority, ...(failures > 0 ? { failures } : {}) },
      this.policy,
    );

    let result: TaskExecutionResult;
    const doneLoad = beginFleetWork('autonomy.task');
    try {
      result = await this.executor(task, model);
    } catch (err) {
      result = { ok: false, summary: 'executor threw', error: err instanceof Error ? err.message : String(err) };
    } finally {
      doneLoad();
    }

    if (result.ok) {
      this.failures.delete(task.id);
      this.store.completeTask(task.id, {
        summary: result.summary,
        filesModified: result.filesModified ?? [],
        ...(result.elapsedSeconds !== undefined ? { elapsedSeconds: result.elapsedSeconds } : {}),
      });
      this.store.updatePresence({ status: 'idle', currentTask: null });
      return { outcome: 'completed', taskId: task.id, taskTitle: task.title, model };
    }

    // Track the failure so the next attempt can escalate up the model ladder.
    this.failures.set(task.id, failures + 1);

    // Failure: log it and release the task so it can be retried (or escalated).
    this.store.appendWorklog({
      agent: this.store.agentId,
      taskId: task.id,
      summary: `Autonomous attempt failed: ${result.summary}`,
      filesModified: [],
      issues: [result.error ?? 'unknown error'],
      nextSteps: ['retry on a later tick or escalate to the strong model'],
    });
    this.store.releaseTask(task.id);
    this.store.updatePresence({ status: 'idle', currentTask: null });
    return {
      outcome: 'failed',
      taskId: task.id,
      taskTitle: task.title,
      model,
      ...(result.error ? { detail: result.error } : {}),
    };
  }
}
