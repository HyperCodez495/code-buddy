export type CapTone = 'safe' | 'warning' | 'danger';

export interface CostProjection {
  currentUsd: number;
  projectedUsd: number;
  capUsd: number;
}

export function projectOverrun(projection: CostProjection): number {
  return Math.max(0, projection.projectedUsd - projection.capUsd);
}

export function capTone(projection: CostProjection): CapTone {
  const ratio = projection.capUsd <= 0 ? Infinity : projection.projectedUsd / projection.capUsd;
  if (ratio >= 1) return 'danger';
  if (ratio >= 0.8) return 'warning';
  return 'safe';
}

export function projectedPercent(projection: CostProjection): number {
  if (projection.capUsd <= 0) return 100;
  return Math.round((projection.projectedUsd / projection.capUsd) * 100);
}
