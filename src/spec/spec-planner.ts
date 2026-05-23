/**
 * Spec planner — the BMAD-inspired multi-agent planning personas.
 *
 * `buddy spec plan` advances one phase per invocation, with a human review gate
 * between each. Each phase is a specialist persona that hands its artifact off to
 * the next: Analyst+PM draft the PRD → an Architect designs the architecture → a
 * Scrum-Master shards the approved spec into small, independently-shippable stories.
 *
 * This module is LLM-agnostic: the model call is INJECTED as `SpecLlmCall` (the same
 * pattern as `planWithLLM` in `src/agent/flow/planning-flow.ts`), so the personas are
 * unit-testable with a fake and the CLI owns provider/client construction.
 */

import type { SpecRiskLevel } from './spec-store.js';
import { logger } from '../utils/logger.js';

/** Injected one-shot model call: a system prompt + a user prompt → text. */
export type SpecLlmCall = (system: string, user: string) => Promise<string>;

const RISK_LEVELS: SpecRiskLevel[] = ['low', 'medium', 'high'];

/** A story emitted by the sharding persona, ready for `SpecStore.addStory`. */
export interface DraftStory {
  title: string;
  /** Optional epic grouping; the CLI maps distinct titles to epic ids. */
  epicTitle?: string;
  narrative: string;
  acceptanceCriteria: string[];
  /** Runner-contract fields (the story IS the contract — see spec-store.ts). */
  allowedPaths: string[];
  verification: string[];
  riskLevel: SpecRiskLevel;
}

// ============================================================================
// Persona system prompts
// ============================================================================

const PRD_SYSTEM = `You are a senior product manager and business analyst. Given a
goal, write a concise, decision-ready Product Requirements Document in Markdown.

Include these sections, in order:
# PRD: <short title>
## Problem
## Target users
## Goals
## Non-goals (explicitly out of scope)
## Functional requirements (numbered)
## Success metrics

Be specific and bounded — prefer a small, shippable first version over an exhaustive
wishlist. Do not invent constraints the goal does not imply. Respond with ONLY the
Markdown document, no commentary and no code fences.`;

const ARCHITECTURE_SYSTEM = `You are a senior software architect. Given a goal and an
approved PRD, write a concise technical architecture in Markdown that an engineer could
implement from. Include these sections:
# Architecture: <short title>
## Components (what the parts are and their responsibilities)
## Data flow (how a request/action moves through the system)
## Key files & patterns (where new code goes; conventions to follow)
## Risks & open questions

Stay grounded in the PRD; do not expand scope. Respond with ONLY the Markdown document,
no commentary and no code fences.`;

const SHARDING_SYSTEM = `You are a technical lead acting as scrum master. Shard an
approved spec (PRD + architecture) into small, independently-shippable stories. Each
story must be doable by an autonomous coding agent in one focused run.

Respond with ONLY a JSON object (no prose, no code fences) of this exact shape:
{
  "stories": [
    {
      "title": "imperative, specific",
      "epicTitle": "optional grouping label",
      "narrative": "the why + concrete implementation guidance",
      "acceptanceCriteria": ["observable, checkable outcome", "..."],
      "allowedPaths": ["bounded relative paths the run may touch, e.g. src/feature"],
      "verification": ["commands that prove it works, e.g. npm test"],
      "riskLevel": "low | medium | high"
    }
  ]
}

Rules:
- 2 to 12 stories. Order them so earlier stories unblock later ones.
- allowedPaths must be relative (never absolute, never "." or "**"), tightly scoped.
- verification must be runnable commands, at least one per story.
- riskLevel: "low" unless the story touches security/auth/db/migrations/CI (then higher).
- Keep each story atomic — one coherent change.`;

// ============================================================================
// Personas
// ============================================================================

/** Phase 1 (Analyst + PM): draft the PRD from the goal. */
export async function generatePrd(llm: SpecLlmCall, goal: string): Promise<string> {
  const text = await llm(PRD_SYSTEM, `Goal:\n${goal}`);
  return stripFences(text).trim();
}

/** Phase 2 (Architect): design the architecture from the goal + approved PRD. */
export async function generateArchitecture(
  llm: SpecLlmCall,
  goal: string,
  prd: string,
): Promise<string> {
  const user = `Goal:\n${goal}\n\nApproved PRD:\n${prd}`;
  const text = await llm(ARCHITECTURE_SYSTEM, user);
  return stripFences(text).trim();
}

/** Phase 3 (Scrum-Master): shard the approved spec into draft stories. */
export async function shardIntoStories(
  llm: SpecLlmCall,
  goal: string,
  prd: string,
  architecture: string,
): Promise<DraftStory[]> {
  const user = `Goal:\n${goal}\n\nApproved PRD:\n${prd}\n\nApproved architecture:\n${architecture}`;
  const raw = await llm(SHARDING_SYSTEM, user);
  return parseStories(raw, goal);
}

// ============================================================================
// Parsing (tolerant — the command must never hard-crash on model output)
// ============================================================================

/**
 * Parse the sharding JSON. On any failure, fall back to a single coarse story so the
 * pipeline degrades gracefully (mirrors `PlanningFlow.createPlan`).
 */
export function parseStories(raw: string, goal: string): DraftStory[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw).trim());
  } catch (err) {
    logger.warn('[spec] sharding output was not valid JSON; using fallback story', {
      error: String(err),
    });
    return [fallbackStory(goal)];
  }

  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { stories?: unknown[] })?.stories)
      ? (parsed as { stories: unknown[] }).stories
      : [];

  const stories = list.map(normalizeStory).filter((s): s is DraftStory => s !== null);
  return stories.length > 0 ? stories : [fallbackStory(goal)];
}

function normalizeStory(value: unknown): DraftStory | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const title = asString(v.title).trim();
  if (!title) return null;
  return {
    title,
    ...(asString(v.epicTitle).trim() ? { epicTitle: asString(v.epicTitle).trim() } : {}),
    narrative: asString(v.narrative).trim(),
    acceptanceCriteria: asStringArray(v.acceptanceCriteria),
    allowedPaths: asStringArray(v.allowedPaths),
    verification: asStringArray(v.verification),
    riskLevel: normalizeRisk(v.riskLevel),
  };
}

function fallbackStory(goal: string): DraftStory {
  return {
    title: truncate(goal, 80) || 'Implement the goal',
    narrative: goal,
    acceptanceCriteria: ['The stated goal is implemented and verified.'],
    allowedPaths: [],
    verification: [],
    riskLevel: 'medium',
  };
}

// ============================================================================
// Helpers
// ============================================================================

/** Strip a leading/anywhere ```json … ``` fence if the model wrapped its output. */
function stripFences(text: string): string {
  return (text ?? '').replace(/```(?:json|markdown|md)?\s*/gi, '').replace(/```\s*/g, '');
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const s = asString(item).trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function normalizeRisk(value: unknown): SpecRiskLevel {
  const s = asString(value).trim().toLowerCase();
  return RISK_LEVELS.includes(s as SpecRiskLevel) ? (s as SpecRiskLevel) : 'low';
}

function truncate(text: string, max: number): string {
  const t = (text ?? '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
