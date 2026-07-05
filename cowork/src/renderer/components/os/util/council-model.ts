export interface CouncilVerdict {
  agentId: string;
  model: string;
  label: string;
  score: number;
  stance: 'approve' | 'revise' | 'reject';
  citation?: string;
}

export interface CouncilSession {
  id: string;
  title: string;
  dhi: number;
  verdicts: CouncilVerdict[];
}

export function scoreSpread(verdicts: CouncilVerdict[]): number {
  if (verdicts.length === 0) {
    return 0;
  }
  const scores = verdicts.map((verdict) => verdict.score);
  return Math.max(...scores) - Math.min(...scores);
}

export function winnerOf(verdicts: CouncilVerdict[]): CouncilVerdict | undefined {
  return [...verdicts].sort((left, right) => right.score - left.score)[0];
}

export function shouldQuoteMinority(spread: number): boolean {
  return spread > 0.3;
}
