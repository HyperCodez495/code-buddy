/**
 * Relationship state — the companion's sense of shared history with Patrice: when it first met
 * him, when it last saw him, and which "we've been together N days" milestones it already marked.
 *
 * This is the substrate for two warm, non-gamified presence moments (see `presence-loop.ts`):
 *   - a **tenure** milestone ("ça fait 30 jours qu'on se côtoie") — MySoulmate's MILESTONE_DAYS
 *     idea, but stripped of the streaks/XP/badges (those are retention dark patterns, not warmth);
 *   - a **reunion** after an absence ("ça faisait 3 jours — content de te retrouver").
 *
 * Pure helpers (`daysBetween`, `pendingMilestone`, `markMilestonesUpTo`) are deterministic and
 * unit-tested; the file I/O is best-effort and never-throws, mirroring `arrival-opener.ts`. Path is
 * overridable via `CODEBUDDY_RELATIONSHIP_STATE_FILE` (keeps tests off the real home dir).
 *
 * @module companion/relationship-state
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

export interface RelationshipState {
  /** Epoch ms the companion first saw Patrice (set once). */
  firstSeenAt?: number;
  /** Epoch ms of the last confirmed sighting (updated every present tick). */
  lastPresentAt?: number;
  /** Tenure milestones (in days-together) already celebrated — so each fires exactly once. */
  celebratedMilestones: number[];
}

/** Days-together marks worth a warm word. Deliberately sparse (never nagging). */
export const MILESTONE_DAYS = [7, 30, 100, 200, 365, 730] as const;

/** A return after this many days without a sighting warrants a "welcome back". */
export const REUNION_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

function defaultStatePath(): string {
  return (
    process.env.CODEBUDDY_RELATIONSHIP_STATE_FILE ||
    join(homedir(), '.codebuddy', 'companion', 'relationship-state.json')
  );
}

export function loadRelationshipState(statePath = defaultStatePath()): RelationshipState {
  try {
    if (existsSync(statePath)) {
      const data = JSON.parse(readFileSync(statePath, 'utf8'));
      return {
        firstSeenAt: typeof data.firstSeenAt === 'number' ? data.firstSeenAt : undefined,
        lastPresentAt: typeof data.lastPresentAt === 'number' ? data.lastPresentAt : undefined,
        celebratedMilestones: Array.isArray(data.celebratedMilestones)
          ? data.celebratedMilestones.filter((n: unknown): n is number => typeof n === 'number')
          : [],
      };
    }
  } catch {
    /* best effort */
  }
  return { celebratedMilestones: [] };
}

export function saveRelationshipState(state: RelationshipState, statePath = defaultStatePath()): void {
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state));
  } catch {
    /* best effort */
  }
}

/** Whole days from `fromMs` to `toMs` (never negative). */
export function daysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, Math.floor((toMs - fromMs) / DAY_MS));
}

/**
 * The milestone to celebrate right now: the highest reached day-mark not yet celebrated, or null.
 * (Highest-first so a backfilled long history announces "100 days", not a belated "7 days".)
 */
export function pendingMilestone(daysTogether: number, celebrated: readonly number[]): number | null {
  let hit: number | null = null;
  for (const m of MILESTONE_DAYS) {
    if (daysTogether >= m && !celebrated.includes(m)) hit = m;
  }
  return hit;
}

/**
 * Mark every milestone up to `daysTogether` as celebrated. Called after a tenure moment fires, so
 * the backlog is cleared in one go (no belated announcements of earlier marks on later days).
 */
export function markMilestonesUpTo(celebrated: readonly number[], daysTogether: number): number[] {
  const set = new Set(celebrated);
  for (const m of MILESTONE_DAYS) {
    if (daysTogether >= m) set.add(m);
  }
  return [...set].sort((a, b) => a - b);
}
