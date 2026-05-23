/**
 * Spec plan runner — UI-agnostic orchestration of the phased `spec plan` flow.
 *
 * The phase machine (prd → architecture → sharding → implementation) and the
 * artifact/story writes live here so BOTH the CLI (`src/commands/spec-plan.ts`)
 * and the Cowork IPC layer drive the exact same logic. Functions return structured
 * results and never touch the console — callers format output.
 *
 * The LLM is injected as `SpecLlmCall`; the store is passed in. Each `advance` call
 * advances exactly one phase, after recording the human approval of the current one.
 */

import type { SpecStore, SpecPhase } from './spec-store.js';
import {
  generatePrd,
  generateArchitecture,
  shardIntoStories,
  type SpecLlmCall,
  type DraftStory,
} from './spec-planner.js';

const GOAL_HEADER = /^<!--\s*goal:\s*([\s\S]*?)\s*-->\s*/;

export interface StartSpecPlanResult {
  projectId: string;
  title: string;
}

export interface AdvanceSpecPlanResult {
  /** The phase AFTER advancing. */
  phase: SpecPhase;
  /** What this step produced, if anything. */
  produced?: 'architecture' | 'stories';
  storiesCreated?: number;
  /** True when called on an already-finished plan (no work done). */
  alreadyComplete?: boolean;
}

/** Create a fresh plan project, draft the PRD, and write `prd.md` (phase = prd). */
export async function startSpecPlan(
  store: SpecStore,
  llm: SpecLlmCall,
  goal: string,
  title?: string,
): Promise<StartSpecPlanResult> {
  const trimmedGoal = (goal ?? '').trim();
  if (!trimmedGoal) throw new Error('A goal is required to start a plan.');
  const project = store.createProject((title ?? '').trim() || deriveTitle(trimmedGoal), 'prd');
  const prd = await generatePrd(llm, trimmedGoal);
  store.writeArtifact(project.id, 'prd', withGoalHeader(trimmedGoal, prd));
  return { projectId: project.id, title: project.title };
}

/** Approve the current phase artifact and run the next persona (one phase). */
export async function advanceSpecPlan(
  store: SpecStore,
  llm: SpecLlmCall,
  projectId: string,
  by: string,
): Promise<AdvanceSpecPlanResult> {
  const reviewer = (by ?? '').trim();
  if (!reviewer) throw new Error('Advancing a plan requires a reviewer (by).');
  const project = store.getProject(projectId);
  if (!project) throw new Error(`Spec project not found: ${projectId}`);
  if (project.phase === 'implementation') {
    return { phase: 'implementation', alreadyComplete: true };
  }

  const goal = readPlanGoal(store, projectId);
  store.recordPlanApproval(projectId, project.phase, reviewer);

  switch (project.phase) {
    case 'prd': {
      const prd = readArtifactOrThrow(store, projectId, 'prd');
      const architecture = await generateArchitecture(llm, goal, prd);
      store.writeArtifact(projectId, 'architecture', architecture);
      store.setPhase(projectId, 'architecture');
      return { phase: 'architecture', produced: 'architecture' };
    }
    case 'architecture': {
      const prd = readArtifactOrThrow(store, projectId, 'prd');
      const architecture = readArtifactOrThrow(store, projectId, 'architecture');
      const stories = await shardIntoStories(llm, goal, prd, architecture);
      const created = persistStories(store, projectId, stories);
      store.setPhase(projectId, 'sharding');
      return { phase: 'sharding', produced: 'stories', storiesCreated: created };
    }
    case 'sharding': {
      store.setPhase(projectId, 'implementation');
      return { phase: 'implementation' };
    }
    default:
      return { phase: project.phase, alreadyComplete: true };
  }
}

/** `--auto`: drive from the current phase all the way to implementation. */
export async function runSpecPlanToCompletion(
  store: SpecStore,
  llm: SpecLlmCall,
  projectId: string,
  by: string,
): Promise<AdvanceSpecPlanResult[]> {
  const steps: AdvanceSpecPlanResult[] = [];
  for (let guard = 0; guard < 8; guard++) {
    const project = store.getProject(projectId);
    if (!project || project.phase === 'implementation') break;
    steps.push(await advanceSpecPlan(store, llm, projectId, by));
  }
  return steps;
}

// ============================================================================
// Shared helpers (used by CLI + Cowork)
// ============================================================================

export function withGoalHeader(goal: string, prd: string): string {
  return `<!-- goal: ${goal} -->\n\n${prd}\n`;
}

/** Recover the original goal from the PRD header comment; fall back to the title. */
export function readPlanGoal(store: SpecStore, projectId: string): string {
  const prd = store.readArtifact(projectId, 'prd') ?? '';
  const match = prd.match(GOAL_HEADER);
  if (match && match[1].trim()) return match[1].trim();
  return store.getProject(projectId)?.title ?? '';
}

function persistStories(store: SpecStore, projectId: string, stories: DraftStory[]): number {
  const epicIds = new Map<string, string>();
  for (const story of stories) {
    let epicId: string | undefined;
    const epicTitle = story.epicTitle?.trim();
    if (epicTitle) {
      if (!epicIds.has(epicTitle)) {
        epicIds.set(epicTitle, store.addEpic(projectId, { title: epicTitle }).id);
      }
      epicId = epicIds.get(epicTitle);
    }
    store.addStory(projectId, {
      title: story.title,
      ...(epicId ? { epicId } : {}),
      narrative: story.narrative,
      acceptanceCriteria: story.acceptanceCriteria,
      allowedPaths: story.allowedPaths,
      verification: story.verification,
      riskLevel: story.riskLevel,
    });
  }
  return stories.length;
}

function readArtifactOrThrow(store: SpecStore, projectId: string, name: 'prd' | 'architecture'): string {
  const content = store.readArtifact(projectId, name);
  if (content === null || !content.trim()) {
    throw new Error(`Missing ${name}.md — run the earlier phase first.`);
  }
  return content;
}

export function deriveTitle(goal: string): string {
  const firstLine = goal.split('\n')[0].trim();
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 79)}…`;
}
