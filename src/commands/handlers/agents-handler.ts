/**
 * Agents (MultiAgentSystem) slash command handler — `/agents`
 *
 * Wires user-facing activation of the MultiAgentSystem
 * (`src/agent/multi-agent/multi-agent-system.ts`). The system has
 * existed since the OpenClaw heritage import but had 0 callers in
 * `src/`, only tests. Top 4 audit OpenClaw 2026-05-02. 4 specialised
 * agents already defined (Orchestrator/Coder/Reviewer/Tester) with 5
 * collaboration strategies.
 *
 * Sub-actions:
 *   /agents enable                 — instantiate the singleton (idempotent)
 *   /agents disable                — dispose, stop active workflow if any
 *   /agents status                 — show enabled flag, active workflow, last result
 *   /agents run <goal>             — FIRE-AND-FORGET workflow (returns immediately)
 *   /agents plan <goal>            — SYNC: dryRun workflow to see the plan only
 *   /agents stop                   — interrupt active workflow
 *   /agents strategy <name>        — set default strategy for next run
 *
 * **V0.1 design decisions** (see plan idempotent-meandering-giraffe.md):
 * - apiKey from `process.env.GROK_API_KEY` (think-handlers.ts pattern).
 *   V0.2 = inject the configured Code Buddy client via `setAgentsClient`.
 * - Fire-and-forget for `run`: singleton + 1 workflow at a time. If user
 *   `run`s while one is active → refuse politely.
 * - Events forwarded to logger.info (visible in ~/.codebuddy/logs/).
 *   V0.2 = stream events live to terminal.
 * - No persistence: process exit kills the workflow. Acceptable V0.1.
 *
 * Slash name `/agents` (not `/team`, `/multi`, `/orchestrate`):
 * - `/team` is taken (Agent Teams lightweight, team-handlers.ts).
 * - `/agents` is libre (grep-confirmed) and matches naming of the
 *   directory `src/agent/multi-agent/agents/`.
 */

import { CommandHandlerResult } from './branch-handlers.js';
import { logger } from '../../utils/logger.js';
import type { CollaborationStrategy, WorkflowResult } from '../../agent/multi-agent/types.js';

const VALID_ACTIONS = new Set([
  'enable', 'disable', 'status', 'run', 'plan', 'stop', 'strategy', 'help', '',
]);

const VALID_STRATEGIES: ReadonlySet<CollaborationStrategy> = new Set<CollaborationStrategy>([
  'sequential', 'parallel', 'hierarchical', 'peer_review', 'iterative',
]);

const HELP_TEXT = `Usage: /agents <action> [args]

Actions:
  enable                  Instantiate the multi-agent system singleton.
  disable                 Dispose; stop active workflow if running.
  status                  Show enabled flag, active workflow (if any), last result.
  run <goal>              FIRE-AND-FORGET: launch a full workflow asynchronously.
                          Returns immediately. Track with /agents status.
                          Stop with /agents stop. Process exit kills it (V0.1).
  plan <goal>             SYNC (~10s): create the execution plan WITHOUT running it.
                          Useful as a preview before /agents run.
  stop                    Interrupt the active workflow.
  strategy <name>         Set default strategy for the next run.
                          One of: sequential | parallel | hierarchical |
                          peer_review | iterative (default: hierarchical).

Configure defaults in TOML under [multi_agent_system]:
  enabled            = false                     # auto-instantiate at boot
  default_strategy   = "hierarchical"
  parallel_agents    = 3
  timeout_ms         = 600000                    # 10 minutes
  max_iterations     = 5

Cost note: a workflow runs 4 agents (orchestrator + coder + reviewer + tester)
with up to N iterations of LLM calls each. Use /agents plan first to preview.
Requires GROK_API_KEY env var.`;

let agentsEnabled = false;
let activeStrategy: CollaborationStrategy = 'hierarchical';

interface ActiveWorkflow {
  goal: string;
  startedAt: Date;
  promise: Promise<WorkflowResult>;
}

interface LastResult {
  goal: string;
  success: boolean;
  summary: string;
  durationMs: number;
  finishedAt: Date;
}

let activeWorkflow: ActiveWorkflow | null = null;
let lastResult: LastResult | null = null;

function textResult(content: string): CommandHandlerResult {
  return {
    handled: true,
    entry: { type: 'assistant', content, timestamp: new Date() },
  };
}

function formatStatus(): string {
  const lines: string[] = [];
  lines.push('Multi-Agent System Status');
  lines.push('═'.repeat(40));
  lines.push(`Enabled:           ${agentsEnabled ? 'yes' : 'no'}`);
  lines.push(`Default strategy:  ${activeStrategy}`);
  lines.push('');

  if (activeWorkflow) {
    const elapsed = Math.round((Date.now() - activeWorkflow.startedAt.getTime()) / 1000);
    lines.push(`ACTIVE WORKFLOW (running):`);
    lines.push(`  Goal:      ${activeWorkflow.goal}`);
    lines.push(`  Started:   ${activeWorkflow.startedAt.toISOString()} (${elapsed}s ago)`);
    lines.push(`  Stop with: /agents stop`);
  } else {
    lines.push('Active workflow:   (none)');
  }

  if (lastResult) {
    lines.push('');
    lines.push(`LAST RESULT:`);
    lines.push(`  Goal:     ${lastResult.goal}`);
    lines.push(`  Success:  ${lastResult.success ? 'yes' : 'no'}`);
    lines.push(`  Duration: ${Math.round(lastResult.durationMs / 1000)}s`);
    lines.push(`  Summary:  ${lastResult.summary.slice(0, 200)}${lastResult.summary.length > 200 ? '…' : ''}`);
  }

  return lines.join('\n');
}

/**
 * /agents <action> [args]
 */
export async function handleAgents(args: string[]): Promise<CommandHandlerResult> {
  const action = (args[0] || 'status').trim().toLowerCase();
  const rest = args.slice(1);

  if (!VALID_ACTIONS.has(action)) {
    return textResult(`Unknown agents action: ${args[0]}\n\n${HELP_TEXT}`);
  }

  if (action === 'help' || action === '') {
    return textResult(HELP_TEXT);
  }

  // Status is read-only — no side effects, no LLM, no instantiation
  if (action === 'status') {
    return textResult(formatStatus());
  }

  // Disable doesn't need apiKey either — just dispose
  if (action === 'disable') {
    if (!agentsEnabled) {
      return textResult('Multi-agent system is not enabled.');
    }
    if (activeWorkflow) {
      const { resetMultiAgentSystem } = await import('../../agent/multi-agent/multi-agent-system.js');
      // System.stop() inside dispose path will signal the running workflow;
      // the promise itself races to completion in the background.
      resetMultiAgentSystem();
      activeWorkflow = null;
    } else {
      const { resetMultiAgentSystem } = await import('../../agent/multi-agent/multi-agent-system.js');
      resetMultiAgentSystem();
    }
    agentsEnabled = false;
    logger.info('MultiAgentSystem disabled via /agents slash command');
    return textResult('Multi-agent system stopped.');
  }

  // Strategy is also a no-op on the singleton — just changes our local default
  if (action === 'strategy') {
    const name = rest[0]?.trim().toLowerCase() as CollaborationStrategy | undefined;
    if (!name) {
      return textResult(`Usage: /agents strategy <name>\nValid: ${[...VALID_STRATEGIES].join(' | ')}`);
    }
    if (!VALID_STRATEGIES.has(name)) {
      return textResult(`Unknown strategy: ${name}\nValid: ${[...VALID_STRATEGIES].join(' | ')}`);
    }
    activeStrategy = name;
    return textResult(`Default strategy set to: ${name}`);
  }

  // Stop interrupts the active workflow
  if (action === 'stop') {
    if (!activeWorkflow) {
      return textResult('No active workflow to stop.');
    }
    const { getMultiAgentSystem } = await import('../../agent/multi-agent/multi-agent-system.js');
    const apiKey = process.env.GROK_API_KEY ?? '';
    const baseURL = process.env.GROK_BASE_URL;
    if (apiKey) {
      const system = getMultiAgentSystem(apiKey, baseURL);
      system.stop();
    }
    const stoppedGoal = activeWorkflow.goal;
    activeWorkflow = null;
    logger.info(`MultiAgentSystem workflow stopped via /agents slash`, { goal: stoppedGoal });
    return textResult(`Workflow stopped: ${stoppedGoal}`);
  }

  // From here on (enable/run/plan), apiKey is needed — pattern from think-handlers.ts L210
  const apiKey = process.env.GROK_API_KEY ?? '';
  const baseURL = process.env.GROK_BASE_URL;
  if (!apiKey) {
    return textResult('Error: GROK_API_KEY is not set. Cannot run multi-agent workflow.');
  }

  const { getMultiAgentSystem } = await import('../../agent/multi-agent/multi-agent-system.js');

  if (action === 'enable') {
    const wasEnabled = agentsEnabled;
    getMultiAgentSystem(apiKey, baseURL); // instantiate singleton
    agentsEnabled = true;
    if (wasEnabled) {
      return textResult('Multi-agent system already enabled. Use /agents status to check state.');
    }
    logger.info('MultiAgentSystem enabled via /agents slash command');
    return textResult(
      'Multi-agent system started.\n' +
      `Default strategy: ${activeStrategy}\n` +
      'Use /agents run <goal> to launch a workflow, /agents plan <goal> to preview only.'
    );
  }

  if (action === 'plan') {
    const goal = rest.join(' ').trim();
    if (!goal) {
      return textResult('Usage: /agents plan <goal>');
    }
    if (!agentsEnabled) {
      getMultiAgentSystem(apiKey, baseURL);
      agentsEnabled = true;
    }
    const system = getMultiAgentSystem(apiKey, baseURL);
    try {
      const result = await system.runWorkflow(goal, { strategy: activeStrategy, dryRun: true });
      const planText = result.plan?.phases?.length
        ? result.plan.phases
            .map((p, i) => `Phase ${i + 1}: ${p.name}\n  ${(p.tasks || []).map((t) => `- ${t.description}`).join('\n  ')}`)
            .join('\n\n')
        : '(no phases parsed — orchestrator returned an empty or unparseable plan)';
      return textResult(`Plan for: ${goal}\n\n${planText}`);
    } catch (err) {
      return textResult(`Planning failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (action === 'run') {
    const goal = rest.join(' ').trim();
    if (!goal) {
      return textResult('Usage: /agents run <goal>');
    }
    if (activeWorkflow) {
      return textResult(
        `Workflow already in progress: ${activeWorkflow.goal}\n` +
        'Stop it first with /agents stop, then re-run.'
      );
    }
    if (!agentsEnabled) {
      getMultiAgentSystem(apiKey, baseURL);
      agentsEnabled = true;
    }
    const system = getMultiAgentSystem(apiKey, baseURL);
    const startedAt = new Date();
    const promise = system.runWorkflow(goal, { strategy: activeStrategy }).then(
      (result) => {
        lastResult = {
          goal,
          success: result.success,
          summary: result.summary || '(no summary)',
          durationMs: result.totalDuration,
          finishedAt: new Date(),
        };
        activeWorkflow = null;
        logger.info('MultiAgentSystem workflow completed', { goal, success: result.success });
        return result;
      },
      (err: unknown) => {
        lastResult = {
          goal,
          success: false,
          summary: `Error: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - startedAt.getTime(),
          finishedAt: new Date(),
        };
        activeWorkflow = null;
        logger.error('MultiAgentSystem workflow failed', { goal, error: String(err) });
        throw err;
      }
    );
    activeWorkflow = { goal, startedAt, promise };
    logger.info(`MultiAgentSystem workflow started`, { goal, strategy: activeStrategy });
    return textResult(
      `Workflow started for: ${goal}\n` +
      `Strategy: ${activeStrategy}\n` +
      `Monitor with: /agents status\n` +
      `Stop with:    /agents stop\n` +
      `(Process exit kills the workflow — V0.1 limitation, no persistence yet.)`
    );
  }

  // Defensive fallback (should never hit due to VALID_ACTIONS gate above)
  return textResult(HELP_TEXT);
}

/**
 * Test hook — reset module state so tests stay isolated.
 * Call alongside resetMultiAgentSystem() in beforeEach/afterEach.
 */
export function _resetAgentsHandlerForTests(): void {
  agentsEnabled = false;
  activeStrategy = 'hierarchical';
  activeWorkflow = null;
  lastResult = null;
}
