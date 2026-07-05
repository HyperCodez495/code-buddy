/**
 * Pure helpers for council deliberation displays.
 *
 * @module renderer/utils/deliberation-model
 */

export interface Verdict {
  id: string;
  model: string;
  score: number;
  position: 'support' | 'oppose' | 'revise';
  reason: string;
}

export function scoreSpread(verdicts: Verdict[]): number {
  if (verdicts.length === 0) return 0;
  const scores = verdicts.map((verdict) => verdict.score);
  return Math.max(...scores) - Math.min(...scores);
}

export function shouldQuoteMinority(spread: number): boolean {
  return spread > 0.3;
}
