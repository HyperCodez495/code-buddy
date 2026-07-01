/**
 * Deliberation Health Index (DHI) — measures the QUALITY of a council
 * deliberation, not its result. Computed in pure TS after every run (no LLM
 * call) and logged as JSONL so degradation is visible over time — notably
 * role erosion: if `stanceDivergence` decays across collective runs, the
 * learning loop is homogenising the council.
 *
 * Components (all 0..1 unless noted):
 *  - seatSurvival        answers / seats — a decimated panel invalidates the rest
 *  - judgeAlive          1 when a NEUTRAL judge returned a parsed verdict
 *  - stanceDivergence    1 − lexical agreement (role-specialised answers SHOULD diverge)
 *  - judgeDiscrimination score spread — a judge scoring everyone alike learns nothing
 *  - dissentRetention    mean share of NON-winners' distinctive terms present in the
 *                        synthesis (null without a synthesis)
 *  - anchorRatio         winner retention / best non-winner retention — >2 means the
 *                        synthesis is a rewrite of the winner (null without synthesis)
 *
 * DHI = seatSurvival × judgeAlive × mean(stanceDivergence, judgeDiscrimination,
 *        min(1, dissentRetention × 4), min(1, 2 / anchorRatio))
 * (null components are dropped from the mean; the first two are multiplicative
 * because a dead judge or empty panel invalidates everything else.)
 *
 * @module council/deliberation-health
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { logger } from '../utils/logger.js';

export interface DeliberationHealth {
  at: string;
  taskType: string;
  planMode: 'direct' | 'collective';
  seats: number;
  answers: number;
  seatSurvival: number;
  judgeAlive: 0 | 1;
  stanceDivergence: number;
  judgeDiscrimination: number;
  dissentRetention: number | null;
  anchorRatio: number | null;
  dhi: number;
}

export interface DeliberationHealthInput {
  at: string;
  taskType: string;
  planMode: 'direct' | 'collective';
  /** Panel seats attempted (local + peers), BEFORE failures. */
  seats: number;
  answers: Array<{ content: string; winner: boolean }>;
  judgeAlive: boolean;
  /** Judge task scores (empty/zeros on abstention). */
  scores: number[];
  /** Lexical agreement 0..1 (consensus.score). */
  consensusScore: number;
  synthesis: string | null;
}

/** Accent-insensitive content words (≥4 chars) — same tokenisation for every component. */
function contentWords(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return new Set(normalized.match(/[a-z][a-z0-9_.-]{3,}/g) ?? []);
}

function retentionInSynthesis(
  answers: Array<{ words: Set<string> }>,
  index: number,
  synthesisWords: Set<string>,
): number {
  const own = answers[index]!.words;
  const distinctive = [...own].filter((w) => answers.every((other, i) => i === index || !other.words.has(w)));
  if (distinctive.length === 0) return 0;
  const retained = distinctive.filter((w) => synthesisWords.has(w)).length;
  return retained / distinctive.length;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

export function computeDeliberationHealth(input: DeliberationHealthInput): DeliberationHealth {
  const seats = Math.max(1, input.seats);
  const seatSurvival = clamp01(input.answers.length / seats);
  const judgeAlive: 0 | 1 = input.judgeAlive ? 1 : 0;
  const stanceDivergence = clamp01(1 - input.consensusScore);
  const finiteScores = input.scores.filter((s) => Number.isFinite(s));
  const judgeDiscrimination =
    finiteScores.length > 1 ? clamp01(Math.max(...finiteScores) - Math.min(...finiteScores)) : 0;

  let dissentRetention: number | null = null;
  let anchorRatio: number | null = null;
  if (input.synthesis && input.answers.length > 1) {
    const tokenised = input.answers.map((a) => ({ words: contentWords(a.content) }));
    const synthesisWords = contentWords(input.synthesis);
    const retentions = input.answers.map((_, i) => retentionInSynthesis(tokenised, i, synthesisWords));
    const winnerRetentions = retentions.filter((_, i) => input.answers[i]!.winner);
    const loserRetentions = retentions.filter((_, i) => !input.answers[i]!.winner);
    if (loserRetentions.length > 0) {
      dissentRetention = loserRetentions.reduce((a, b) => a + b, 0) / loserRetentions.length;
      const bestLoser = Math.max(...loserRetentions);
      const winner = winnerRetentions.length > 0 ? Math.max(...winnerRetentions) : 0;
      anchorRatio = bestLoser > 0 ? winner / bestLoser : winner > 0 ? Number.POSITIVE_INFINITY : null;
    }
  }

  const components = [stanceDivergence, judgeDiscrimination];
  if (dissentRetention !== null) components.push(Math.min(1, dissentRetention * 4));
  if (anchorRatio !== null) {
    components.push(anchorRatio === 0 ? 1 : Math.min(1, 2 / anchorRatio));
  }
  const mean = components.reduce((a, b) => a + b, 0) / components.length;
  const dhi = clamp01(seatSurvival * judgeAlive * mean);

  return {
    at: input.at,
    taskType: input.taskType,
    planMode: input.planMode,
    seats,
    answers: input.answers.length,
    seatSurvival,
    judgeAlive,
    stanceDivergence,
    judgeDiscrimination,
    dissentRetention,
    anchorRatio: anchorRatio === Number.POSITIVE_INFINITY ? 99 : anchorRatio,
    dhi,
  };
}

function defaultHealthLedgerPath(): string {
  return path.join(os.homedir(), '.codebuddy', 'council-deliberation-health.jsonl');
}

/** Append one health record (JSONL, never-throws) — the CLI presenter's default sink. */
export function appendDeliberationHealth(health: DeliberationHealth, file: string = defaultHealthLedgerPath()): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(health) + '\n', 'utf-8');
  } catch (err) {
    logger.warn?.('[deliberation-health] could not append record', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
