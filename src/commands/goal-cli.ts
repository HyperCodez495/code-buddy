/**
 * buddy goal — headless Ralph loop.
 *
 * Runs the full agentic loop toward a standing goal: each turn the agent
 * works with tools, then the goal judge decides done/continue. Continuation
 * prompts are fed back in-process until the goal is achieved, the turn
 * budget is exhausted, or the judge auto-pauses.
 *
 * Usage:
 *   buddy goal "Fix every failing test in tests/auth/"
 *   buddy goal "Ship the feature" --max-turns 10 --judge-model qwen3:8b
 *
 * Exit codes: 0 = goal done, 1 = paused (budget/judge) or error.
 */

import { Command } from 'commander';
import type { ChatEntry } from '../agent/codebuddy-agent.js';
import type { CodeBuddyClient } from '../codebuddy/client.js';
import { maybeContinueGoalAfterTurn } from '../goals/goal-loop.js';
import { getGoalManager } from '../goals/goal-manager.js';
import { GoalStatus } from '../goals/goal-state.js';
import { resolveCommandProvider } from './llm-provider-resolution.js';

/** The slice of CodeBuddyAgent the loop needs — injectable for tests. */
export interface GoalLoopAgent {
  processUserMessage(input: string): Promise<ChatEntry[]>;
  getClient(): CodeBuddyClient;
}

export interface GoalLoopRunOptions {
  maxTurns?: number;
  /** Progress sink (status lines ⊙/↻/✓/⏸). Defaults to silent. */
  onMessage?: (text: string) => void;
}

export interface GoalLoopRunResult {
  status: GoalStatus | 'unknown';
  turnsUsed: number;
  lastReason?: string;
}

/**
 * Drive the goal loop headlessly on an in-process agent. Sets the goal,
 * runs the first turn with the goal text (mirroring the interactive
 * `/goal <text>` kick-off), then follows judge verdicts until the loop
 * stops continuing.
 */
export async function runGoalLoop(
  agent: GoalLoopAgent,
  goalText: string,
  options: GoalLoopRunOptions = {}
): Promise<GoalLoopRunResult> {
  const manager = getGoalManager();
  const state = manager.set(goalText, options.maxTurns ? { maxTurns: options.maxTurns } : {});
  const emit = options.onMessage ?? (() => {});
  emit(`⊙ Goal set (${state.maxTurns}-turn budget): ${state.goal}`);

  let prompt = state.goal;
  // Hard backstop on top of the manager's own budget/auto-pause guards.
  const maxIterations = state.maxTurns + 1;
  for (let i = 0; i < maxIterations; i++) {
    const entries = await agent.processUserMessage(prompt);
    const lastResponse = entries
      .filter(entry => entry.type === 'assistant' && entry.content)
      .map(entry => entry.content)
      .join('\n');

    const outcome = await maybeContinueGoalAfterTurn({
      client: agent.getClient(),
      lastResponse,
      interrupted: false,
    });
    if (outcome?.message) emit(outcome.message);
    if (!outcome?.continuationPrompt) break;
    prompt = outcome.continuationPrompt;
  }

  const final = manager.state;
  return {
    status: final?.status ?? 'unknown',
    turnsUsed: final?.turnsUsed ?? 0,
    ...(final?.lastReason ? { lastReason: final.lastReason } : {}),
  };
}

export function createGoalCommand(): Command {
  const cmd = new Command('goal')
    .description('Run the agent toward a standing goal until a judge model confirms it is done (Ralph loop)')
    .argument('<goal>', 'The goal to pursue')
    .option('--max-turns <n>', 'Turn budget (default 20, or goals.maxTurns from settings)')
    .option('--judge-model <model>', 'Model for the goal judge (default: session model)')
    .option('-m, --model <model>', 'Override the agent model for this run')
    .option('--max-tool-rounds <n>', 'Max tool rounds per turn', '50')
    .action(async (goal: string, options, command) => {
      const modelOverride: string | undefined = options.model ?? command?.optsWithGlobals?.()?.model;
      const resolved = resolveCommandProvider({ explicitModel: modelOverride });
      if (!resolved) {
        console.error(
          'Error: No provider available — set an API key, run `buddy onboard`, or point CODEBUDDY_PROVIDER=ollama at a local Ollama.'
        );
        process.exit(1);
      }

      if (options.judgeModel) {
        process.env.CODEBUDDY_GOAL_JUDGE_MODEL = options.judgeModel;
      }
      process.env.CODEBUDDY_DISABLE_MCP = process.env.CODEBUDDY_DISABLE_MCP ?? 'true';
      process.env.CODEBUDDY_HEADLESS = 'true';

      try {
        const { CodeBuddyAgent } = await import('../agent/codebuddy-agent.js');
        const { ConfirmationService } = await import('../utils/confirmation-service.js');
        ConfirmationService.getInstance().setSessionFlag('allOperations', true);

        const agent = new CodeBuddyAgent(
          resolved.apiKey,
          resolved.baseURL,
          resolved.model,
          parseInt(options.maxToolRounds, 10)
        );
        await agent.systemPromptReady;

        const result = await runGoalLoop(agent, goal, {
          ...(options.maxTurns ? { maxTurns: parseInt(options.maxTurns, 10) } : {}),
          onMessage: text => console.log(`\n${text}`),
        });

        agent.dispose?.();
        process.exit(result.status === 'done' ? 0 : 1);
      } catch (err) {
        console.error('Goal error:', err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });

  return cmd;
}
