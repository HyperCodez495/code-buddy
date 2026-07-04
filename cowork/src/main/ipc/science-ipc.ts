/**
 * `science.*` IPC — the READ-ONLY tracking surface for the AI-Scientist-lite
 * experiment loop (`buddy science`), feeding the new-shell "AI-Scientist" panel.
 *
 * The core writes SCORED experiment variants to an append-only JSONL store at the
 * canonical path `<workspace>/.codebuddy/science/experiment-variants.json`
 * (`ExperimentVariantStore`, see `src/agent/science/experiment-variant-store.ts`).
 * Each line is one variant: `{ id, hypothesis, code, executionResult, metric,
 * score, passedAll, regressions, parentId?, kept, createdAt }`.
 *
 * This surface ONLY reads that store and derives a summary + the best variant.
 * There is DELIBERATELY no run/start/execute handler — launching an experiment
 * stays a CLI-only action (`buddy science …`) for safety; the GUI can never spawn
 * one. The store file is opened read-only (a single `readFileSync`); parsing
 * mirrors `ExperimentVariantStore.list()` (JSONL lines + the legacy
 * `{schemaVersion,variants:[…]}` object) and is self-contained so the panel works
 * without the core `dist/` being built. Every handler never-throws: an absent /
 * empty / unreadable / corrupt store degrades to `{ variants: [], … }`.
 *
 * @module main/ipc/science-ipc
 */

import { ipcMain } from 'electron';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { logError } from '../utils/logger';

/** A compact, panel-facing view of one scored experiment variant. */
export interface ScienceVariantView {
  id: string;
  hypothesis: string;
  language: string;
  score: number;
  passedAll: boolean;
  regressions: string[];
  /** Genealogy: the parent variant this one was derived from (absent = root). */
  parentId?: string;
  /** True ONLY after the human keep-gate approved (never set implicitly). */
  kept: boolean;
  createdAt: string;
  metric: { name: string; value: number | null; score: number; detail?: string };
  execution: {
    ok: boolean;
    exitCode: number | null;
    timedOut: boolean;
    durationMs: number;
    runId: string;
  };
  detail?: string;
  /** Size of the experiment program in bytes (the code itself is not shipped whole). */
  codeBytes: number;
  /** Bounded preview of the experiment program (first 4000 chars). */
  codePreview: string;
}

/** A lightweight roll-up of the whole store (drives the panel header / status badge). */
export interface ScienceSummary {
  /** Total variants recorded (append-only — includes rejected ones). */
  total: number;
  /** Variants that passed everything and have no regression. */
  passed: number;
  /** Variants the human keep-gate approved. */
  kept: number;
  /** The best eligible variant's score, or null when none qualify. */
  bestScore: number | null;
  /** The most recent variant's ISO timestamp, or null when empty. */
  latestAt: string | null;
  /** Absolute path of the store file that was read. */
  storePath: string;
  /** Whether the store file exists on disk. */
  exists: boolean;
}

export interface ScienceListResult {
  variants: ScienceVariantView[];
  best: ScienceVariantView | null;
  summary: ScienceSummary;
}

/** The raw record shape as written by `ExperimentVariantStore.record()`. */
interface RawVariant {
  id?: unknown;
  hypothesis?: unknown;
  code?: unknown;
  language?: unknown;
  executionResult?: {
    ok?: unknown;
    exitCode?: unknown;
    timedOut?: unknown;
    durationMs?: unknown;
    runId?: unknown;
  };
  metric?: { name?: unknown; value?: unknown; score?: unknown; detail?: unknown };
  score?: unknown;
  passedAll?: unknown;
  regressions?: unknown;
  parentId?: unknown;
  kept?: unknown;
  createdAt?: unknown;
  detail?: unknown;
}

const CODE_PREVIEW_LIMIT = 4000;

/**
 * The canonical experiment-variant store path for a workspace. Mirrors the core
 * `defaultStorePath()` in `experiment-variant-store.ts`: `<cwd>/.codebuddy/science/
 * experiment-variants.json`. Keyed off the active workspace (like `evolve.listVariants`).
 */
function resolveStorePath(cwd?: string): string {
  const base = cwd && cwd.trim() ? cwd : process.cwd();
  return join(base, '.codebuddy', 'science', 'experiment-variants.json');
}

/**
 * Read + parse the store file (never-throws). Mirrors `ExperimentVariantStore.list()`:
 * a legacy single-object `{schemaVersion,variants:[…]}` blob OR one JSONL variant per
 * line; a torn/corrupt line is skipped rather than nuking the whole store.
 */
function readRawVariants(path: string): { exists: boolean; records: RawVariant[] } {
  if (!existsSync(path)) return { exists: false, records: [] };
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    logError('[science] variant store unreadable:', error);
    return { exists: true, records: [] };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { exists: true, records: [] };
  // Backward-compat: an older single-object store `{schemaVersion,variants:[…]}`.
  if (trimmed.startsWith('{') && trimmed.includes('"variants"')) {
    try {
      const data = JSON.parse(trimmed) as { variants?: unknown };
      if (Array.isArray(data.variants)) return { exists: true, records: data.variants as RawVariant[] };
    } catch {
      /* fall through to best-effort JSONL */
    }
  }
  const records: RawVariant[] = [];
  for (const line of trimmed.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      records.push(JSON.parse(t) as RawVariant);
    } catch {
      /* skip a corrupt line */
    }
  }
  return { exists: true, records };
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function asNullableNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Project a raw store record into the compact, bounded panel view. */
function toView(rec: RawVariant): ScienceVariantView {
  const code = asString(rec.code);
  const regressions = Array.isArray(rec.regressions)
    ? rec.regressions.filter((r): r is string => typeof r === 'string')
    : [];
  const view: ScienceVariantView = {
    id: asString(rec.id),
    hypothesis: asString(rec.hypothesis),
    language: asString(rec.language),
    score: asNumber(rec.score),
    passedAll: rec.passedAll === true,
    regressions,
    kept: rec.kept === true,
    createdAt: asString(rec.createdAt),
    metric: {
      name: asString(rec.metric?.name),
      value: asNullableNumber(rec.metric?.value),
      score: asNumber(rec.metric?.score),
      ...(typeof rec.metric?.detail === 'string' ? { detail: rec.metric.detail } : {}),
    },
    execution: {
      ok: rec.executionResult?.ok === true,
      exitCode: asNullableNumber(rec.executionResult?.exitCode),
      timedOut: rec.executionResult?.timedOut === true,
      durationMs: asNumber(rec.executionResult?.durationMs),
      runId: asString(rec.executionResult?.runId),
    },
    codeBytes: Buffer.byteLength(code, 'utf8'),
    codePreview: code.slice(0, CODE_PREVIEW_LIMIT),
  };
  if (typeof rec.parentId === 'string' && rec.parentId) view.parentId = rec.parentId;
  if (typeof rec.detail === 'string' && rec.detail) view.detail = rec.detail;
  return view;
}

/**
 * The winner: highest-scoring variant that passed everything and has no
 * regression (mirrors `ExperimentVariantStore.best()` defaults). Ties broken by
 * most recent. null if none qualify.
 */
function computeBest(views: ScienceVariantView[]): ScienceVariantView | null {
  const eligible = views.filter((v) => v.passedAll && v.regressions.length === 0);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, v) => {
    if (v.score > best.score) return v;
    if (v.score === best.score && v.createdAt > best.createdAt) return v;
    return best;
  });
}

function summarize(
  views: ScienceVariantView[],
  best: ScienceVariantView | null,
  storePath: string,
  exists: boolean,
): ScienceSummary {
  const latestAt = views.reduce<string | null>(
    (acc, v) => (v.createdAt && (!acc || v.createdAt > acc) ? v.createdAt : acc),
    null,
  );
  return {
    total: views.length,
    passed: views.filter((v) => v.passedAll && v.regressions.length === 0).length,
    kept: views.filter((v) => v.kept).length,
    bestScore: best ? best.score : null,
    latestAt,
    storePath,
    exists,
  };
}

function loadStore(cwd?: string): ScienceListResult {
  const storePath = resolveStorePath(cwd);
  const { exists, records } = readRawVariants(storePath);
  const variants = records.map(toView);
  const best = computeBest(variants);
  return { variants, best, summary: summarize(variants, best, storePath, exists) };
}

export function registerScienceIpcHandlers(): void {
  // AI-Scientist tracking — READ-ONLY. Lists the scored experiment variants +
  // the best one + a summary for the new-shell "AI-Scientist" panel. There is NO
  // run/start/execute handler by design: launching an experiment stays CLI-only
  // (`buddy science`). Reads the canonical JSONL store directly (self-contained,
  // works without the core dist). All handlers never-throw (absent/empty/corrupt
  // store → `{ variants: [], … }`).
  ipcMain.handle('science.listVariants', async (_event, cwd?: string): Promise<ScienceListResult> => {
    try {
      return loadStore(typeof cwd === 'string' ? cwd : undefined);
    } catch (error) {
      logError('[science] listVariants failed:', error);
      const storePath = resolveStorePath(typeof cwd === 'string' ? cwd : undefined);
      return {
        variants: [],
        best: null,
        summary: {
          total: 0,
          passed: 0,
          kept: 0,
          bestScore: null,
          latestAt: null,
          storePath,
          exists: false,
        },
      };
    }
  });

  ipcMain.handle('science.status', async (_event, cwd?: string): Promise<ScienceSummary> => {
    try {
      return loadStore(typeof cwd === 'string' ? cwd : undefined).summary;
    } catch (error) {
      logError('[science] status failed:', error);
      const storePath = resolveStorePath(typeof cwd === 'string' ? cwd : undefined);
      return { total: 0, passed: 0, kept: 0, bestScore: null, latestAt: null, storePath, exists: false };
    }
  });
}
