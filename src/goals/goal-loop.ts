/**
 * After-turn goal driver — UI-agnostic port of Hermes'
 * `_maybe_continue_goal_after_turn`.
 *
 * Called by the interactive turn loop after each completed turn. Decides
 * whether to surface a status message and/or feed a continuation prompt
 * back into the session. Safe to call when no goal is set — returns fast.
 */

import { CodeBuddyClient } from '../codebuddy/client.js';
import { logger } from '../utils/logger.js';
import { decomposeGoal, shouldAutoDecomposeGoal } from './goal-decomposer.js';
import { judgeGoal } from './goal-judge.js';
import { GoalManager, getGoalManager, resolveGoalsConfig } from './goal-manager.js';

export interface GoalTurnOutcome {
  /** User-visible status line (✓ / ⏸ / ↻) to append to chat history. */
  message?: string;
  /** When set, the caller should auto-submit this as the next user message. */
  continuationPrompt?: string;
}

export interface GoalAfterTurnOptions {
  client: CodeBuddyClient | null;
  /** The assistant's full response text for the turn that just finished. */
  lastResponse: string;
  /** True when the turn was user-interrupted (Esc). */
  interrupted: boolean;
  /** Optional goal-state key for host surfaces with their own session ids. */
  sessionKey?: string;
}

// The executor appends a per-turn usage footer ("[tokens: … | cost: …]") as a
// final content chunk; strip it so the judge sees only substantive output.
const USAGE_FOOTER_RE = /\n?\[tokens: [^\]]*\]\s*$/;

export async function maybeContinueGoalAfterTurn(
  options: GoalAfterTurnOptions
): Promise<GoalTurnOutcome | null> {
  const manager = getGoalManager(options.sessionKey);
  if (!manager.isActive()) return null;

  // If the turn was user-interrupted, auto-pause instead of judging: the
  // judge would almost always say "continue" on the partial output and
  // immediately re-queue another turn — exactly what the user cancelled.
  if (options.interrupted) {
    try {
      manager.pause('user-interrupted (Esc)');
    } catch (error) {
      logger.debug('goal pause-on-interrupt failed', { error: String(error) });
    }
    return {
      message: '⏸ Goal paused — turn was interrupted. Use /goal resume to continue, or /goal clear to stop.',
    };
  }

  const lastResponse = options.lastResponse.replace(USAGE_FOOTER_RE, '').trim();
  // No substantive reply (transient API failure, empty stream): skip judging
  // so we don't burn budget or trip the parse-failure counter.
  if (!lastResponse) return null;

  const config = resolveGoalsConfig();
  await maybeAttachGoalPlan(manager, options.client, config.plannerModel);
  const decision = await manager.evaluateAfterTurn(lastResponse, {
    judge: params =>
      judgeGoal(options.client, {
        ...params,
        ...(config.judgeModel ? { model: config.judgeModel } : {}),
        maxTokens: config.judgeMaxTokens,
        timeoutMs: config.judgeTimeoutMs,
      }),
  });

  if (decision.verdict === 'inactive') return null;

  const outcome: GoalTurnOutcome = {};
  if (decision.message) outcome.message = decision.message;
  if (decision.shouldContinue && decision.continuationPrompt) {
    outcome.continuationPrompt = decision.continuationPrompt;
  }
  return outcome;
}

async function maybeAttachGoalPlan(
  manager: GoalManager,
  client: CodeBuddyClient | null,
  model?: string
): Promise<void> {
  const state = manager.state;
  if (!state || state.goalPlan || state.goalPlanAttempted) return;
  if (!client || !shouldAutoDecomposeGoal(state.goal)) return;

  try {
    const plan = await decomposeGoal(state.goal, client, {
      ...(model ? { model } : {}),
    });
    if (plan) {
      manager.attachGoalPlan(plan);
    } else {
      manager.markGoalPlanAttempted('planner returned no usable task graph');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    manager.markGoalPlanAttempted(message);
    logger.debug('goal decomposition failed', { error: message });
  }
}
