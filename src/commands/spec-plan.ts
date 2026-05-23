/**
 * `buddy spec plan` — BMAD-inspired, multi-agent, phased, review-gated planning.
 *
 * Each invocation advances ONE phase of the active spec project and then exits for a
 * human to review the artifact it wrote:
 *
 *   (none) ──start <goal>──▶ prd            writes prd.md            [review]
 *    prd   ──continue──▶ architecture       writes architecture.md   [review]
 *    architecture ──continue──▶ sharding    shards → draft stories   [review/approve]
 *    sharding ──continue──▶ implementation  (done; ready for `buddy spec next`)
 *
 * The phase machine + artifact writes live in `src/spec/spec-plan-runner.ts` so this
 * CLI and the Cowork IPC layer share identical logic; this file only owns the provider
 * wiring and console formatting. The LLM is injected (default builds a CodeBuddyClient
 * from settings), so the command is unit-testable with a fake.
 */

import { Command } from 'commander';
import { getSpecStore } from '../spec/spec-store.js';
import type { SpecProject } from '../spec/spec-store.js';
import {
  startSpecPlan,
  advanceSpecPlan,
  runSpecPlanToCompletion,
  type AdvanceSpecPlanResult,
} from '../spec/spec-plan-runner.js';
import type { SpecLlmCall } from '../spec/spec-planner.js';
import { getSettingsManager } from '../utils/settings-manager.js';
import { PROVIDERS } from './provider.js';

/** Builds the one-shot model call when a phase actually needs the LLM. */
export type SpecLlmProvider = () => Promise<SpecLlmCall>;

/**
 * Build the `plan` sub-command group.
 * @param llmProvider override for tests; defaults to a real CodeBuddyClient.
 */
export function createPlanCommand(llmProvider: SpecLlmProvider = defaultLlmProvider): Command {
  const cmd = new Command('plan');
  cmd.description('Agentic, phased, review-gated planning (PRD → architecture → stories)');

  // ---- start ---------------------------------------------------------------
  cmd
    .command('start <goal...>')
    .description('Start a new plan: draft the PRD for review (phase → prd)')
    .option('--title <title>', 'Project title (default: derived from the goal)')
    .option('--auto', 'Run all phases without stopping (still requires --by)', false)
    .option('--by <name>', 'Reviewer (required with --auto)')
    .action(async (goalParts: string[], opts: { title?: string; auto?: boolean; by?: string }) => {
      const goal = goalParts.join(' ').trim();
      if (!goal) return fail('A goal is required: buddy spec plan start "<goal>"');
      if (opts.auto && !(opts.by ?? '').trim()) {
        return fail('--auto runs every gate at once, so it still requires --by <reviewer>.');
      }

      let llm: SpecLlmCall;
      try {
        llm = await llmProvider();
      } catch (err) {
        return fail(err);
      }

      const store = getSpecStore(process.cwd());
      try {
        console.log('Drafting PRD…');
        const { projectId, title } = await startSpecPlan(store, llm, goal, opts.title);
        console.log(`Created spec project [${projectId}]: ${title}`);
        console.log(`Wrote ${artifactHint(projectId, 'prd')}`);

        if (opts.auto) {
          const steps = await runSpecPlanToCompletion(store, llm, projectId, opts.by!.trim());
          for (const step of steps) printAdvanceResult(store, projectId, step);
          console.log('Auto-plan finished.');
          return;
        }
        console.log(
          `Review it, then: buddy spec plan continue --by <you>${hintProject(store, projectId)}`,
        );
      } catch (err) {
        return fail(err);
      }
    });

  // ---- continue ------------------------------------------------------------
  cmd
    .command('continue')
    .description('Approve the current phase and run the next persona')
    .requiredOption('--by <name>', 'Human reviewer approving the current phase artifact')
    .option('-p, --project <id>', 'Project id (default: active)')
    .action(async (opts: { by: string; project?: string }) => {
      const store = getSpecStore(process.cwd());
      const projectId = resolveProjectId(store, opts.project);
      if (!projectId) return;

      let llm: SpecLlmCall;
      try {
        llm = await llmProvider();
      } catch (err) {
        return fail(err);
      }

      try {
        const result = await advanceSpecPlan(store, llm, projectId, opts.by);
        if (result.alreadyComplete) {
          console.log('Plan already complete. Approve stories with: buddy spec story approve <id> --by <name>');
          return;
        }
        printAdvanceResult(store, projectId, result);
      } catch (err) {
        return fail(err);
      }
    });

  // ---- status --------------------------------------------------------------
  cmd
    .command('status')
    .description('Show the plan phase, artifacts on disk, and the next command')
    .option('-p, --project <id>', 'Project id (default: active)')
    .action((opts: { project?: string }) => {
      const store = getSpecStore(process.cwd());
      const projectId = resolveProjectId(store, opts.project);
      if (!projectId) return;
      const project = store.getProject(projectId);
      if (!project) return fail(`Spec project not found: ${projectId}`);

      console.log(`Project [${project.id}] ${project.title} — phase: ${project.phase}`);
      console.log(`  prd.md:          ${store.readArtifact(projectId, 'prd') ? 'present' : 'missing'}`);
      console.log(`  architecture.md: ${store.readArtifact(projectId, 'architecture') ? 'present' : 'missing'}`);
      console.log(`  stories:         ${store.listStories(projectId).length}`);
      if (project.planApprovals) {
        for (const [phase, info] of Object.entries(project.planApprovals)) {
          if (info) console.log(`  approved ${phase}: ${info.by}`);
        }
      }
      console.log(`Next: ${nextCommand(project)}`);
    });

  return cmd;
}

// ============================================================================
// Console formatting (CLI-only)
// ============================================================================

function printAdvanceResult(
  store: ReturnType<typeof getSpecStore>,
  projectId: string,
  result: AdvanceSpecPlanResult,
): void {
  const tail = hintProject(store, projectId);
  if (result.produced === 'architecture') {
    console.log(`Wrote ${artifactHint(projectId, 'architecture')}`);
    console.log(`Review it, then: buddy spec plan continue --by <you>${tail}`);
    return;
  }
  if (result.produced === 'stories') {
    const n = result.storiesCreated ?? 0;
    console.log(`Created ${n} draft stor${n === 1 ? 'y' : 'ies'}.`);
    console.log('Review them (buddy spec story list), then either:');
    console.log('  - approve each:  buddy spec story approve <id> --by <you>');
    console.log(`  - finalize plan: buddy spec plan continue --by <you>${tail}`);
    return;
  }
  if (result.phase === 'implementation') {
    console.log('Plan complete (phase → implementation). Approved stories are ready to implement.');
  }
}

// ============================================================================
// Default LLM provider (real CodeBuddyClient — mirrors src/commands/flow.ts)
// ============================================================================

async function defaultLlmProvider(): Promise<SpecLlmCall> {
  const settingsManager = getSettingsManager();
  const userSettings = settingsManager.loadUserSettings();
  const providerKey = userSettings.provider || 'grok';
  const providerInfo = PROVIDERS[providerKey];

  let apiKey = process.env[providerInfo?.envVar || ''] || '';
  if (!apiKey) {
    apiKey =
      process.env.GROK_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      '';
  }
  if (!apiKey) throw new Error('No API key configured. Run: buddy onboard');

  const { CodeBuddyClient } = await import('../codebuddy/client.js');
  const model = settingsManager.getCurrentModel() || providerInfo?.defaultModel;
  const client = new CodeBuddyClient(apiKey, model, providerInfo?.baseURL);

  return async (system: string, user: string): Promise<string> => {
    const response = await client.chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    return response?.choices?.[0]?.message?.content || '';
  };
}

// ============================================================================
// Helpers
// ============================================================================

function nextCommand(project: SpecProject): string {
  switch (project.phase) {
    case 'prd':
    case 'architecture':
      return `buddy spec plan continue --by <you> -p ${project.id}`;
    case 'sharding':
      return `buddy spec story approve <id> --by <you>  (or: buddy spec plan continue --by <you> -p ${project.id})`;
    case 'implementation':
      return 'plan complete — implement approved stories';
    default:
      return 'buddy spec plan continue --by <you>';
  }
}

function artifactHint(projectId: string, name: 'prd' | 'architecture'): string {
  return `.codebuddy/specs/${projectId}/${name}.md`;
}

/** Add `-p <id>` to a hint only when the project is not the sole/active one. */
function hintProject(store: ReturnType<typeof getSpecStore>, projectId: string): string {
  return store.getActiveProjectId() === projectId ? '' : ` -p ${projectId}`;
}

function resolveProjectId(
  store: ReturnType<typeof getSpecStore>,
  explicit?: string,
): string | null {
  if (explicit) {
    if (!store.getProject(explicit)) {
      fail(`Spec project not found: ${explicit}`);
      return null;
    }
    return explicit;
  }
  const active = store.getActiveProjectId();
  if (!active) {
    fail('No active spec project. Start one with: buddy spec plan start "<goal>"');
    return null;
  }
  return active;
}

function fail(err: unknown): void {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
