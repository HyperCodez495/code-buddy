export type PrivacyTier = 'low' | 'medium' | 'high';

export interface RouteAlternative {
  id: string;
  label: string;
  targetType: 'model' | 'peer';
  costUsd: number;
  latencyMs: number;
  privacyTier: PrivacyTier;
  available: boolean;
}

export interface RankedRouteAlternative extends RouteAlternative {
  score: number;
}

const privacyPenalty: Record<PrivacyTier, number> = { low: 0, medium: 20, high: 50 };

export function privacyImpact(alternative: Pick<RouteAlternative, 'privacyTier' | 'targetType'>): string {
  if (alternative.privacyTier === 'high') return alternative.targetType === 'peer' ? 'Données sensibles exposées au pair' : 'Données sensibles hors posture sûre';
  if (alternative.privacyTier === 'medium') return 'Contexte partiel à limiter';
  return 'Impact vie privée faible';
}

export function rankAlternatives(alternatives: RouteAlternative[]): RankedRouteAlternative[] {
  return alternatives
    .map((alternative) => ({
      ...alternative,
      score: alternative.available ? 1000 - alternative.costUsd * 100 - alternative.latencyMs / 10 - privacyPenalty[alternative.privacyTier] : -Infinity,
    }))
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
}
