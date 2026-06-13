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
import { DEFAULT_COLAB_GOAL_MAX_TURNS, type ColabGoalJudge } from './colab-goal.js';

export interface TaskExecutionResult {
  ok: boolean;
  summary: string;
  filesModified?: ColabWorklogFileChange[];
  elapsedSeconds?: number;
  error?: string;
  /**
   * Tail of the worker's actual output (capped). Goal-mode judges evaluate
   * this; absent for executors that don't capture output (judge falls back
   * to `summary`).
   */
  output?: string;
}

export type TaskExecutor = (
  task: ColabTask,
  model: AutonomousModelChoice,
) => Promise<TaskExecutionResult>;

function resolveGoalMaxTurns(raw: unknown): number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0
    ? raw
    : DEFAULT_COLAB_GOAL_MAX_TURNS;
}

function resolveGoalTurnsUsed(raw: unknown): number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
}

export interface AutonomousLoopConfig {
  store: FleetColabStore;
  tierConfig: ModelTierConfig;
  executor: TaskExecutor;
  policy?: ModelTierPolicy;
  /** Kill-switch — when it returns false the tick is a no-op. Default: always on. */
  enabled?: () => boolean;
  /**
   * Judge for `goalMode` tasks (Hermes kanban goal-mode parity). When absent,
   * goal-mode tasks complete like plain tasks (no judge gate).
   */
  goalJudge?: ColabGoalJudge;
}

export interface TickResult {
  outcome: 'disabled' | 'idle' | 'completed' | 'failed' | 'saturated' | 'goal_continue' | 'goal_blocked';
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
  private readonly goalJudge: ColabGoalJudge | undefined;

  constructor(config: AutonomousLoopConfig) {
    this.store = config.store;
    this.tierConfig = config.tierConfig;
    this.executor = config.executor;
    this.policy = config.policy ?? {};
    this.enabled = config.enabled ?? (() => true);
    this.goalJudge = config.goalJudge;
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
      // Goal-mode gate (Hermes kanban goal-mode): a successful attempt is not
      // enough — the judge must confirm the task's criteria are satisfied.
      if (task.goalMode && this.goalJudge) {
        const goalOutcome = await this.evaluateGoalModeTask(task, result, model);
        if (goalOutcome) return goalOutcome;
        // null → judge said done (or skipped): fall through to completion.
      }
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

  /**
   * Goal-mode decision ladder. Returns a TickResult when the loop should NOT
   * complete the task (judge says continue / budget exhausted), or null when
   * the task may complete (judge done/skipped, or judge unreachable —
   * fail-open like the interactive Ralph loop).
   */
  private async evaluateGoalModeTask(
    task: ColabTask,
    result: TaskExecutionResult,
    model: AutonomousModelChoice,
  ): Promise<TickResult | null> {
    let verdict;
    try {
      verdict = await this.goalJudge!(task, result, model);
    } catch {
      return null; // fail-open: an unusable judge never blocks completion
    }
    if (verdict.verdict !== 'continue') return null;

    const maxTurns = resolveGoalMaxTurns(task.goalMaxTurns);
    const turnsUsed = resolveGoalTurnsUsed(task.goalTurnsUsed) + 1;

    if (turnsUsed >= maxTurns) {
      // Hermes rule: block for human review instead of spinning forever.
      const reason = `goal budget exhausted (${turnsUsed}/${maxTurns}) — judge: ${verdict.reason}`;
      this.store.recordGoalTurn(task.id, verdict.reason);
      this.store.blockTask(task.id, reason);
      this.store.appendWorklog({
        agent: this.store.agentId,
        taskId: task.id,
        summary: `Goal-mode blocked after ${turnsUsed}/${maxTurns} turns: ${verdict.reason}`,
        filesModified: result.filesModified ?? [],
        issues: [reason],
        nextSteps: ['human review: unblock, split, or complete the task manually'],
      });
      this.store.updatePresence({ status: 'idle', currentTask: null });
      return { outcome: 'goal_blocked', taskId: task.id, taskTitle: task.title, model, detail: verdict.reason };
    }

    // Under budget: persist the consumed turn + reason, release the task so a
    // later tick continues it with the continuation nudge. A judge "continue"
    // is NOT an executor failure — the model ladder must not escalate.
    this.store.recordGoalTurn(task.id, verdict.reason);
    this.store.appendWorklog({
      agent: this.store.agentId,
      taskId: task.id,
      summary: `Goal-mode turn ${turnsUsed}/${maxTurns} — judge: continue: ${verdict.reason}`,
      filesModified: result.filesModified ?? [],
      issues: [],
      nextSteps: ['continue on a later tick with the goal continuation nudge'],
    });
    this.store.releaseTask(task.id);
    this.store.updatePresence({ status: 'idle', currentTask: null });
    return { outcome: 'goal_continue', taskId: task.id, taskTitle: task.title, model, detail: verdict.reason };
  }
}
