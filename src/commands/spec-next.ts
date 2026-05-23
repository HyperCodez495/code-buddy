/**
 * `buddy spec next` — feed the next approved story to the autonomous coding runner.
 *
 * This is the execution end of the BMAD-inspired pipeline (Commit 3). It closes the
 * collaboration loop: the planning personas (`buddy spec plan`) produce review-gated
 * stories, a human approves one, and `spec next` hands that story — now carrying its
 * runner-contract fields (`allowedPaths` / `verification` / `riskLevel`) — to the
 * autonomous coding runner, which can itself delegate to fleet peers (`--fleet`).
 *
 * Lineage is durable: story → run (runId) → outcome. The story transitions
 * `approved → in_progress` before the run and, based on the run's terminal status,
 * `→ done` (with the verification as evidence) or `→ blocked` (with the reason). A run
 * that only scaffolds (no edit proposal supplied) leaves the story `in_progress` with
 * an explicit next step — never a false completion.
 *
 * The runner is 286KB+; it is lazy-imported inside the action so it never inflates CLI
 * boot. The contract module is small and imported normally.
 */

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { getSpecStore } from '../spec/spec-store.js';
import type { SpecStory, SpecRiskLevel } from '../spec/spec-store.js';
import {
  validateAgenticCodingTaskContract,
  type AgenticCodingTaskContract,
} from '../agent/autonomous/agentic-coding-contract.js';

type FleetPolicy = AgenticCodingTaskContract['fleetPolicy'];

interface NextOptions {
  project?: string;
  story?: string;
  allowedPath: string[];
  verify: string[];
  fleet: string;
  risk?: string;
  editProposalFile?: string;
  apply?: boolean;
  runVerification?: boolean;
  output: string;
  dryRun?: boolean;
}

export function createNextCommand(): Command {
  const cmd = new Command('next');
  cmd
    .description('Feed the next approved story to the autonomous coding runner (lineage: story → run → outcome)')
    .option('-p, --project <id>', 'Project id (default: active)')
    .option('--story <id>', 'Run a specific story instead of the oldest approved one')
    .option('--allowed-path <path>', 'Add/override allowedPaths (repeatable)', collect, [])
    .option('--verify <cmd>', 'Add/override verification commands (repeatable)', collect, [])
    .option('--fleet <policy>', 'Fleet collaboration: none | read-only-help | delegated-slices', 'none')
    .option('--risk <level>', 'Override riskLevel: low | medium | high')
    .option('--edit-proposal-file <path>', 'Apply a pre-produced edit proposal (drives the story toward done)')
    .option('--apply', 'Apply edits (requires --edit-proposal-file)', false)
    .option('--run-verification', 'Execute the verification commands', false)
    .option('--output <fmt>', 'Contract output format: text | json', 'text')
    .option('--dry-run', 'Print the contract and exit without transitioning or running', false)
    .action(async (opts: NextOptions) => {
      const store = getSpecStore(process.cwd());
      const projectId = resolveProjectId(store, opts.project);
      if (!projectId) return;

      const story = pickStory(store, projectId, opts.story);
      if (!story) return; // pickStory already reported why

      // ---- build + validate the contract BEFORE any state transition ----------
      const task = buildTaskText(story);
      if (!task) {
        return fail(
          `Story ${story.id} has no narrative or acceptance criteria — re-shard or edit it before running.`,
        );
      }
      const allowedPaths = unique([...opts.allowedPath, ...(story.allowedPaths ?? [])]);
      const verification = unique([...opts.verify, ...(story.verification ?? [])]);
      const fleetPolicy = parseFleetPolicy(opts.fleet);
      const riskLevel = parseRisk(opts.risk) ?? story.riskLevel ?? 'low';

      const candidate = {
        repo: process.cwd(),
        task,
        allowedPaths,
        verification,
        riskLevel,
        output: opts.output === 'json' ? 'json' : 'text',
        fleetPolicy,
      };
      const validation = validateAgenticCodingTaskContract(candidate);
      if (!validation.success) {
        console.error(`Cannot build a task contract from story ${story.id}:`);
        for (const err of validation.errors) console.error(`  - ${err}`);
        console.error(
          'Supply the missing fields with --allowed-path / --verify, or re-shard the story so it carries them.',
        );
        process.exit(1);
        return;
      }
      const contract = validation.contract;

      if (opts.dryRun) {
        console.log(JSON.stringify(contract, null, 2));
        console.log(`\n(dry run — story ${story.id} left ${story.status})`);
        return;
      }

      // ---- durable run dir + task file (lineage artifact) ---------------------
      const runId = `spec-${story.id}-${Date.now()}`;
      const runDir = path.join(process.cwd(), '.codebuddy', 'specs', projectId, 'runs', runId);
      fs.mkdirSync(runDir, { recursive: true });
      const taskFile = path.join(runDir, 'task.json');
      fs.writeFileSync(taskFile, `${JSON.stringify(contract, null, 2)}\n`, 'utf-8');

      // ---- transition + run ---------------------------------------------------
      store.startStory(projectId, story.id, { runId });
      console.log(`Story ${story.id} → IN_PROGRESS (run ${runId})`);

      let report: import('../agent/autonomous/agentic-coding-runner.js').AgenticCodingRunReport;
      try {
        const runner = await import('../agent/autonomous/agentic-coding-runner.js');
        report = await runner.runAgenticCodingCell({
          taskFile,
          runId,
          ...(opts.editProposalFile ? { editProposalFile: path.resolve(opts.editProposalFile) } : {}),
          applyEdits: Boolean(opts.apply),
          runVerification: Boolean(opts.runVerification),
        });
        // Persist the report next to the task for lineage.
        await runner.writeAgenticCodingRunReport(report, path.join(runDir, 'report.json'));
        console.log(runner.renderAgenticCodingRunReport(report));
      } catch (err) {
        const reason = `autonomous run failed: ${err instanceof Error ? err.message : String(err)}`;
        store.blockStory(projectId, story.id, reason);
        return fail(`Story ${story.id} → BLOCKED: ${reason}`);
      }

      // ---- map terminal status to a story transition -------------------------
      applyOutcome(store, projectId, story.id, runId, report);
    });

  return cmd;
}

// ============================================================================
// Outcome mapping
// ============================================================================

type RunReport = import('../agent/autonomous/agentic-coding-runner.js').AgenticCodingRunReport;

function applyOutcome(
  store: ReturnType<typeof getSpecStore>,
  projectId: string,
  storyId: string,
  runId: string,
  report: RunReport,
): void {
  switch (report.status) {
    case 'verified': {
      const evidence = summarizeVerification(report) || `autonomous run ${runId} verified`;
      store.completeStory(projectId, storyId, evidence);
      console.log(`Story ${storyId} → DONE (evidence: ${evidence})`);
      return;
    }
    case 'blocked':
    case 'validation_failed':
    case 'verification_failed': {
      const reason = summarizeFailure(report) || `run ${runId} ended ${report.status}`;
      store.blockStory(projectId, storyId, reason);
      console.log(`Story ${storyId} → BLOCKED: ${reason}`);
      return;
    }
    default: {
      // 'ready' | 'previewed' | 'edited' — scaffolded but not verified. Stay honest.
      console.log(`Story ${storyId} stays IN_PROGRESS (run status: ${report.status}).`);
      console.log(
        '  Supply edits to finish it:  buddy spec next --story ' +
          `${storyId} --edit-proposal-file <proposal.json> --apply --run-verification`,
      );
      console.log(`  Or block it:  buddy spec story block ${storyId} --reason "<why>"`);
    }
  }
}

function summarizeVerification(report: RunReport): string {
  const parts = report.verification.map((v) => `${v.command}: ${v.status}`);
  return parts.join('; ');
}

function summarizeFailure(report: RunReport): string {
  const failedChecks = report.verification
    .filter((v) => v.status !== 'passed')
    .map((v) => `${v.command} ${v.status}${v.reason ? ` (${v.reason})` : ''}`);
  return [...report.blockedReasons, ...report.validationErrors, ...failedChecks]
    .filter(Boolean)
    .join('; ');
}

// ============================================================================
// Helpers
// ============================================================================

function pickStory(
  store: ReturnType<typeof getSpecStore>,
  projectId: string,
  explicitId?: string,
): SpecStory | null {
  if (explicitId) {
    const story = store.getStory(projectId, explicitId);
    if (!story) {
      fail(`Story not found: ${explicitId}`);
      return null;
    }
    if (story.status !== 'approved') {
      fail(`Story ${explicitId} is ${story.status}, not approved. Approve it first: buddy spec story approve ${explicitId} --by <name>`);
      return null;
    }
    return story;
  }
  const approved = store.listStories(projectId, 'approved'); // oldest first (createdAt)
  if (approved.length === 0) {
    console.log('No approved stories. Approve one with: buddy spec story approve <id> --by <name>');
    return null;
  }
  return approved[0];
}

function buildTaskText(story: SpecStory): string {
  const parts: string[] = [story.title];
  if (story.narrative.trim()) parts.push('', story.narrative.trim());
  if (story.acceptanceCriteria.length > 0) {
    parts.push('', 'Acceptance criteria:', ...story.acceptanceCriteria.map((c) => `- ${c}`));
  }
  return parts.join('\n').trim();
}

function parseFleetPolicy(value: string): FleetPolicy {
  const v = (value ?? '').trim();
  if (v === 'read-only-help' || v === 'delegated-slices' || v === 'none') return v;
  throw new Error('--fleet must be one of: none, read-only-help, delegated-slices');
}

function parseRisk(value?: string): SpecRiskLevel | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'low' || v === 'medium' || v === 'high') return v;
  throw new Error('--risk must be one of: low, medium, high');
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = (raw ?? '').trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
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

function fail(message: string): void {
  console.error(message);
  process.exit(1);
}
