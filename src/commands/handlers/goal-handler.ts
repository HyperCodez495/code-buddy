import type { CodeBuddyClient } from '../../codebuddy/client.js';
import {
  decomposeGoal,
  formatGoalPlan,
  shouldAutoDecomposeGoal,
  type GoalPlan,
} from '../../goals/goal-decomposer.js';
import { getGoalManager } from '../../goals/goal-manager.js';
import { CommandHandlerResult } from './branch-handlers.js';

export interface GoalHandlerOptions {
  sessionKey?: string;
  client?: CodeBuddyClient | null;
  planner?: (goal: string, client: CodeBuddyClient) => Promise<GoalPlan | null>;
}

/**
 * /goal — standing goal with judge + auto-continue loop (the Ralph loop,
 * ported from Hermes Agent).
 *
 * Forms:
 *   /goal <text>     set a new goal (replaces any old one) and start turn 1
 *   /goal | status   show current state
 *   /goal pause      halt auto-continuation, keep the goal
 *   /goal resume     restart the loop (resets the turn budget)
 *   /goal clear      discard the goal (aliases: stop, done)
 */
export async function handleGoal(
  args: string[],
  options: GoalHandlerOptions = {}
): Promise<CommandHandlerResult> {
  const arg = args.join(' ').trim();
  const lower = arg.toLowerCase();
  const mgr = getGoalManager(options.sessionKey);

  if (!arg || lower === 'status') {
    return textResult(mgr.statusLine());
  }

  if (lower === 'pause') {
    const state = mgr.pause('user-paused');
    return textResult(state ? `⏸ Goal paused: ${state.goal}` : 'No goal set.');
  }

  if (lower === 'resume') {
    const state = mgr.resume();
    if (!state) {
      return textResult('No goal to resume.');
    }
    return textResult(
      `▶ Goal resumed: ${state.goal}\n` +
        'Send any message to kick the loop off (e.g. "continue").'
    );
  }

  if (['clear', 'stop', 'done'].includes(lower)) {
    const had = mgr.hasGoal();
    mgr.clear();
    return textResult(had ? '✓ Goal cleared.' : 'No active goal.');
  }

  // Otherwise treat the arg as the goal text.
  let plan: GoalPlan | null = null;
  let planAttempted = false;
  let planError = '';
  if (options.client && shouldAutoDecomposeGoal(arg)) {
    planAttempted = true;
    try {
      plan = await (options.planner ?? decomposeGoal)(arg, options.client);
    } catch (error) {
      planError = error instanceof Error ? error.message : String(error);
    }
  }

  let state;
  try {
    state = mgr.set(arg, {
      ...(plan ? { goalPlan: plan } : {}),
      ...(planAttempted ? { goalPlanAttempted: true } : {}),
    });
    if (planAttempted && !plan && planError) {
      mgr.markGoalPlanAttempted(planError);
      state = mgr.state ?? state;
    }
  } catch (error) {
    return textResult(`Invalid goal: ${error instanceof Error ? error.message : String(error)}`);
  }

  const planBlock = state.goalPlan
    ? `\n\nHermes-style task graph attached:\n${formatGoalPlan(state.goalPlan)}`
    : planError
      ? `\n\nGoal planning was skipped after an LLM planner error: ${planError}`
      : '';

  return {
    handled: true,
    entry: {
      type: 'assistant',
      content:
        `⊙ Goal set (${state.maxTurns}-turn budget): ${state.goal}\n` +
        'After each turn, a judge model checks if the goal is done. Code Buddy ' +
        'keeps working until it is, you pause/clear it, or the budget is ' +
        'exhausted. Use /goal status, /goal pause, /goal resume, /goal clear. ' +
        'Tip: for unattended runs, enable auto-approval (/yolo or auto-edit) so ' +
        'the loop is not blocked on confirmations.' +
        planBlock,
      timestamp: new Date(),
    },
    // Kick the loop off immediately — the dispatcher feeds the goal text as
    // the first turn, then the after-turn hook drives the continuation loop.
    passToAI: true,
    prompt: state.goal,
  };
}

/**
 * /subgoal — extra acceptance criteria added mid-loop.
 *
 * Forms:
 *   /subgoal                show current subgoals
 *   /subgoal <text>         append a criterion
 *   /subgoal remove <n>     drop subgoal n (1-based)
 *   /subgoal clear          wipe all subgoals
 *
 * Subgoals get appended to both the judge prompt (verdict must consider
 * them) and the continuation prompt (agent sees them) on the next turn
 * boundary — no special kick needed.
 */
export async function handleSubgoal(
  args: string[],
  options: GoalHandlerOptions = {}
): Promise<CommandHandlerResult> {
  const arg = args.join(' ').trim();
  const mgr = getGoalManager(options.sessionKey);

  if (!mgr.hasGoal()) {
    return textResult('No active goal. Set one with /goal <text>.');
  }

  if (!arg) {
    return textResult(`${mgr.statusLine()}\n${mgr.renderSubgoals()}`);
  }

  const [verb, ...restTokens] = arg.split(/\s+/);
  const rest = restTokens.join(' ').trim();

  if (verb?.toLowerCase() === 'remove') {
    if (!rest) {
      return textResult('Usage: /subgoal remove <n>');
    }
    const indexToken = rest.split(/\s+/)[0] ?? '';
    const idx = Number(indexToken);
    if (!/^[1-9]\d*$/.test(indexToken) || !Number.isSafeInteger(idx)) {
      return textResult('/subgoal remove: <n> must be a positive integer (1-based index).');
    }
    try {
      const removed = mgr.removeSubgoal(idx);
      return textResult(`✓ Removed subgoal ${idx}: ${removed}`);
    } catch (error) {
      return textResult(`/subgoal remove: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (verb?.toLowerCase() === 'clear') {
    try {
      const prev = mgr.clearSubgoals();
      return textResult(prev ? `✓ Cleared ${prev} subgoal${prev !== 1 ? 's' : ''}.` : 'No subgoals to clear.');
    } catch (error) {
      return textResult(`/subgoal clear: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Otherwise — append the whole arg as a new subgoal.
  try {
    const text = mgr.addSubgoal(arg);
    const idx = mgr.state?.subgoals.length ?? 0;
    return textResult(`✓ Added subgoal ${idx}: ${text}`);
  } catch (error) {
    return textResult(`/subgoal: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function textResult(content: string): CommandHandlerResult {
  return {
    handled: true,
    entry: { type: 'assistant', content, timestamp: new Date() },
  };
}
