/**
 * Pure helpers for task routing visualization.
 *
 * @module renderer/utils/routing-model
 */

export interface RouteDecision {
  target: string;
  reason: string;
  costUsd: number;
  latencyMs: number;
  privacy: 'public' | 'internal' | 'sensitive';
  peer?: string;
}

export function privacyFlag(route: RouteDecision): 'ok' | 'warn' {
  return route.privacy === 'sensitive' ? 'warn' : 'ok';
}

export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
