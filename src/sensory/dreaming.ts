/**
 * Dreaming — heartbeat-paced memory consolidation. Every N beats, the short-term
 * sensory buffer is drained and consolidated into a compact "dream" summary
 * (counts by kind, salient events, time window, average load) appended to a
 * long-term dream journal. The heartbeat-paced analogue of OpenClaw's dreaming
 * (short-term recall → consolidated long-term memory).
 *
 * @module sensory/dreaming
 */

import { appendFile, mkdir } from 'fs/promises';
import path from 'path';

import { getSensoryMemory } from './sensory-memory.js';
import { logger } from '../utils/logger.js';
import type { Perception } from './reactions.js';

const SALIENT_THRESHOLD = 128;

export interface DreamSummary {
  dreamedAt: number;
  windowStartMs: number | null;
  windowEndMs: number | null;
  total: number;
  /** "audio/speech_start" → count, "vital/heartbeat" → count, … */
  byKind: Record<string, number>;
  salient: Array<{ modality?: string; kind?: string; salience?: number; tsMs?: number }>;
  avgLoad: number | null;
}

/** Pure consolidation: summarize a window of perceptions into a dream. */
export function consolidate(perceptions: Perception[], now: number): DreamSummary {
  const byKind: Record<string, number> = {};
  const salient: DreamSummary['salient'] = [];
  let loadSum = 0;
  let loadN = 0;
  let minTs: number | null = null;
  let maxTs: number | null = null;

  for (const p of perceptions) {
    const key = `${p.modality}/${p.kind}`;
    byKind[key] = (byKind[key] ?? 0) + 1;
    if ((p.salience ?? 0) >= SALIENT_THRESHOLD) {
      salient.push({ modality: p.modality, kind: p.kind, salience: p.salience, tsMs: p.tsMs });
    }
    const load = (p.payload as { load1?: unknown } | undefined)?.load1;
    if (typeof load === 'number') {
      loadSum += load;
      loadN += 1;
    }
    if (typeof p.tsMs === 'number') {
      minTs = minTs === null ? p.tsMs : Math.min(minTs, p.tsMs);
      maxTs = maxTs === null ? p.tsMs : Math.max(maxTs, p.tsMs);
    }
  }

  return {
    dreamedAt: now,
    windowStartMs: minTs,
    windowEndMs: maxTs,
    total: perceptions.length,
    byKind,
    salient: salient.slice(0, 20),
    avgLoad: loadN > 0 ? loadSum / loadN : null,
  };
}

export interface DreamingOptions {
  cwd?: string;
  now?: number;
}

/**
 * One dreaming pass: drain the short-term buffer, consolidate, append to the
 * dream journal. Returns the summary, or null if there was nothing to consolidate.
 */
export async function runDreamingPass(options: DreamingOptions = {}): Promise<DreamSummary | null> {
  const perceptions = getSensoryMemory().drain();
  if (perceptions.length === 0) return null;

  const summary = consolidate(perceptions, options.now ?? Date.now());
  try {
    const dir = path.join(options.cwd ?? process.cwd(), '.codebuddy', 'companion');
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, 'dreams.jsonl'), `${JSON.stringify(summary)}\n`, 'utf8');
  } catch (err) {
    logger.warn(`[dreaming] could not persist dream: ${err instanceof Error ? err.message : String(err)}`);
  }
  logger.info(
    `[dreaming] consolidated ${summary.total} perception(s) → ${Object.keys(summary.byKind).length} kind(s), ${summary.salient.length} salient, avg load ${summary.avgLoad ?? '?'}`,
  );
  return summary;
}
