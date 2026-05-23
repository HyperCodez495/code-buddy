/**
 * `buddy spec` CLI — BMAD-inspired spec-driven, review-gated work pipeline.
 *
 * Work is a durable backlog of stories under `.codebuddy/specs/<project>/`. A
 * story cannot be implemented until a human approves its spec; completing one
 * requires evidence; blocking requires a reason. This is the structured,
 * multi-story counterpart to the quick single-objective `buddy dev` path.
 *
 * This is the LLM-free foundation: stories are added manually with
 * `buddy spec story add`. Agent-driven PRD/architecture/story generation and
 * per-story autonomous implementation are layered on separately.
 */

import { Command } from 'commander';
import { getSpecStore, SPEC_STORY_STATUSES } from '../spec/spec-store.js';
import type { SpecStory, SpecStoryStatus } from '../spec/spec-store.js';
import { createPlanCommand } from './spec-plan.js';
import { createNextCommand } from './spec-next.js';

export function createSpecCommand(): Command {
  const cmd = new Command('spec');
  cmd.description(
    'Spec-driven, review-gated work pipeline (durable stories; approve before implementing)',
  );

  // ---- init ----------------------------------------------------------------
  cmd
    .command('init <title...>')
    .description('Create a spec project and make it active')
    .action((titleParts: string[]) => {
      const project = getSpecStore(process.cwd()).createProject(titleParts.join(' '));
      console.log(`Created spec project [${project.id}]: ${project.title}`);
      console.log('Add stories with: buddy spec story add "<title>"');
    });

  // ---- list (projects) -----------------------------------------------------
  cmd
    .command('list')
    .description('List spec projects')
    .option('--json', 'Output JSON')
    .action((opts: { json?: boolean }) => {
      const store = getSpecStore(process.cwd());
      const projects = store.listProjects();
      const activeId = store.getActiveProjectId();
      if (opts.json) {
        console.log(JSON.stringify({ activeId, projects }, null, 2));
        return;
      }
      if (projects.length === 0) {
        console.log('No spec projects yet. Create one with: buddy spec init "<title>"');
        return;
      }
      for (const p of projects) {
        console.log(`${p.id === activeId ? '*' : ' '} [${p.id}] ${p.title}  (phase: ${p.phase})`);
      }
    });

  // ---- status --------------------------------------------------------------
  cmd
    .command('status')
    .description('Show sprint status of the active (or --project) project')
    .option('-p, --project <id>', 'Project id (default: active)')
    .option('--json', 'Output JSON')
    .action((opts: { project?: string; json?: boolean }) => {
      const store = getSpecStore(process.cwd());
      const projectId = resolveProjectId(store, opts.project);
      if (!projectId) return;
      const status = store.getSprintStatus(projectId);
      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      console.log(`Project [${status.projectId}] ${status.title} — phase: ${status.phase}`);
      console.log(
        `Stories: ${status.total} ` +
          `(draft ${status.byStatus.draft}, approved ${status.byStatus.approved}, ` +
          `in_progress ${status.byStatus.in_progress}, done ${status.byStatus.done}, ` +
          `blocked ${status.byStatus.blocked})`,
      );
      for (const s of status.stories) {
        console.log(`  [${s.id}] ${s.status.toUpperCase().padEnd(11)} ${s.title}`);
      }
    });

  cmd.addCommand(createPlanCommand());
  cmd.addCommand(createNextCommand());
  cmd.addCommand(createStoryCommand());
  cmd.addCommand(createEpicCommand());

  return cmd;
}

// ============================================================================
// story subcommands
// ============================================================================

function createStoryCommand(): Command {
  const cmd = new Command('story');
  cmd.description('Manage stories (add, show, approve, start, complete, block, reopen)');

  cmd
    .command('add <title...>')
    .description('Add a story (status: draft)')
    .option('-p, --project <id>', 'Project id (default: active)')
    .option('-e, --epic <id>', 'Parent epic id')
    .option('-n, --narrative <text>', 'Context-engineered narrative / why')
    .option('-c, --criteria <text>', 'Acceptance criterion (repeatable)', collect, [])
    .action((titleParts: string[], opts: { project?: string; epic?: string; narrative?: string; criteria: string[] }) => {
      const store = getSpecStore(process.cwd());
      const projectId = resolveProjectId(store, opts.project);
      if (!projectId) return;
      try {
        const story = store.addStory(projectId, {
          title: titleParts.join(' '),
          ...(opts.epic ? { epicId: opts.epic } : {}),
          ...(opts.narrative ? { narrative: opts.narrative } : {}),
          acceptanceCriteria: opts.criteria,
        });
        console.log(`Added story [${story.id}] (draft): ${story.title}`);
        console.log(`Approve it with: buddy spec story approve ${story.id} --by <name>`);
      } catch (err) {
        fail(err);
      }
    });

  cmd
    .command('list')
    .description('List stories, optionally filtered by status')
    .option('-p, --project <id>', 'Project id (default: active)')
    .option('-s, --status <status>', `Filter: ${SPEC_STORY_STATUSES.join('|')}`)
    .option('--json', 'Output JSON')
    .action((opts: { project?: string; status?: string; json?: boolean }) => {
      const store = getSpecStore(process.cwd());
      const projectId = resolveProjectId(store, opts.project);
      if (!projectId) return;
      const status = opts.status?.toLowerCase() as SpecStoryStatus | undefined;
      if (status && !SPEC_STORY_STATUSES.includes(status)) {
        console.error(`Invalid status: ${status}. Must be one of: ${SPEC_STORY_STATUSES.join(', ')}`);
        process.exit(1);
      }
      const stories = store.listStories(projectId, status);
      if (opts.json) {
        console.log(JSON.stringify(stories, null, 2));
        return;
      }
      if (stories.length === 0) {
        console.log(status ? `No ${status} stories.` : 'No stories yet.');
        return;
      }
      for (const s of stories) console.log(formatStoryLine(s));
    });

  cmd
    .command('show <id>')
    .description('Show a story')
    .option('-p, --project <id>', 'Project id (default: active)')
    .option('--json', 'Output JSON')
    .action((id: string, opts: { project?: string; json?: boolean }) => {
      const store = getSpecStore(process.cwd());
      const projectId = resolveProjectId(store, opts.project);
      if (!projectId) return;
      const story = store.getStory(projectId, id);
      if (!story) {
        console.error(`Story not found: ${id}`);
        process.exit(1);
        return;
      }
      if (opts.json) {
        console.log(JSON.stringify(story, null, 2));
        return;
      }
      console.log(formatStoryLine(story));
      if (story.reviewedBy) console.log(`  approved by: ${story.reviewedBy}`);
      if (story.blockedReason) console.log(`  blocked: ${story.blockedReason}`);
      if (story.evidence) console.log(`  evidence: ${story.evidence}`);
      if (story.acceptanceCriteria.length > 0) {
        console.log('  acceptance criteria:');
        for (const c of story.acceptanceCriteria) console.log(`    - ${c}`);
      }
      if (story.narrative) console.log(`  narrative: ${story.narrative}`);
    });

  // -- transitions --
  cmd
    .command('approve <id>')
    .description('Approve a story (draft → approved); required before implementation')
    .requiredOption('--by <name>', 'Human reviewer')
    .option('-p, --project <id>', 'Project id (default: active)')
    .action((id: string, opts: { by: string; project?: string }) =>
      runTransition(opts.project, (store, pid) => store.approveStory(pid, id, opts.by)));

  cmd
    .command('start <id>')
    .description('Start a story (approved → in_progress)')
    .option('-p, --project <id>', 'Project id (default: active)')
    .option('--run <runId>', 'Link the implementing run id')
    .action((id: string, opts: { project?: string; run?: string }) =>
      runTransition(opts.project, (store, pid) =>
        store.startStory(pid, id, opts.run ? { runId: opts.run } : undefined)));

  cmd
    .command('complete <id>')
    .description('Complete a story (in_progress → done); requires evidence')
    .requiredOption('--evidence <text>', 'Proof the acceptance criteria are met (e.g. tests green)')
    .option('-p, --project <id>', 'Project id (default: active)')
    .action((id: string, opts: { evidence: string; project?: string }) =>
      runTransition(opts.project, (store, pid) => store.completeStory(pid, id, opts.evidence)));

  cmd
    .command('block <id>')
    .description('Block a story; requires a reason')
    .requiredOption('--reason <text>', 'Why it is blocked')
    .option('-p, --project <id>', 'Project id (default: active)')
    .action((id: string, opts: { reason: string; project?: string }) =>
      runTransition(opts.project, (store, pid) => store.blockStory(pid, id, opts.reason)));

  cmd
    .command('reopen <id>')
    .description('Reopen a story back to draft (from blocked or approved)')
    .option('-p, --project <id>', 'Project id (default: active)')
    .action((id: string, opts: { project?: string }) =>
      runTransition(opts.project, (store, pid) => store.reopenStory(pid, id)));

  return cmd;
}

// ============================================================================
// epic subcommands
// ============================================================================

function createEpicCommand(): Command {
  const cmd = new Command('epic');
  cmd.description('Manage epics');

  cmd
    .command('add <title...>')
    .description('Add an epic')
    .option('-p, --project <id>', 'Project id (default: active)')
    .option('-s, --summary <text>', 'Epic summary')
    .action((titleParts: string[], opts: { project?: string; summary?: string }) => {
      const store = getSpecStore(process.cwd());
      const projectId = resolveProjectId(store, opts.project);
      if (!projectId) return;
      try {
        const epic = store.addEpic(projectId, {
          title: titleParts.join(' '),
          ...(opts.summary ? { summary: opts.summary } : {}),
        });
        console.log(`Added epic [${epic.id}]: ${epic.title}`);
      } catch (err) {
        fail(err);
      }
    });

  cmd
    .command('list')
    .description('List epics')
    .option('-p, --project <id>', 'Project id (default: active)')
    .option('--json', 'Output JSON')
    .action((opts: { project?: string; json?: boolean }) => {
      const store = getSpecStore(process.cwd());
      const projectId = resolveProjectId(store, opts.project);
      if (!projectId) return;
      const epics = store.listEpics(projectId);
      if (opts.json) {
        console.log(JSON.stringify(epics, null, 2));
        return;
      }
      if (epics.length === 0) {
        console.log('No epics yet.');
        return;
      }
      for (const e of epics) console.log(`[${e.id}] ${e.title}${e.summary ? ` — ${e.summary}` : ''}`);
    });

  return cmd;
}

// ============================================================================
// Helpers
// ============================================================================

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

function resolveProjectId(
  store: ReturnType<typeof getSpecStore>,
  explicit?: string,
): string | null {
  if (explicit) {
    if (!store.getProject(explicit)) {
      console.error(`Spec project not found: ${explicit}`);
      process.exit(1);
    }
    return explicit;
  }
  const active = store.getActiveProjectId();
  if (!active) {
    console.error('No active spec project. Create one with: buddy spec init "<title>"');
    process.exit(1);
    return null;
  }
  return active;
}

function runTransition(
  projectOpt: string | undefined,
  fn: (store: ReturnType<typeof getSpecStore>, projectId: string) => SpecStory,
): void {
  const store = getSpecStore(process.cwd());
  const projectId = resolveProjectId(store, projectOpt);
  if (!projectId) return;
  try {
    const story = fn(store, projectId);
    console.log(`Story ${story.id} → ${story.status.toUpperCase()}: ${story.title}`);
  } catch (err) {
    fail(err);
  }
}

function fail(err: unknown): void {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

function formatStoryLine(s: SpecStory): string {
  const epic = s.epicId ? ` · ${s.epicId}` : '';
  return `[${s.id}] ${s.status.toUpperCase().padEnd(11)} ${s.title}${epic}`;
}
