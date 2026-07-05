/**
 * Pure helpers for pre-execution dry-run estimates.
 *
 * @module renderer/utils/dryrun-estimate
 */

export type PlanRisk = 'low' | 'medium' | 'high';

export interface PlanStep {
  id: string;
  title: string;
  tool: string;
  detail?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  durationMs?: number;
  risk?: PlanRisk;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
}

function positiveNumber(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : 0;
}

export function estimatePlan(steps: PlanStep[]): CostEstimate {
  return steps.reduce<CostEstimate>(
    (estimate, step) => {
      const inputTokens = positiveNumber(step.inputTokens);
      const outputTokens = positiveNumber(step.outputTokens);
      estimate.inputTokens += inputTokens;
      estimate.outputTokens += outputTokens;
      estimate.totalTokens += inputTokens + outputTokens;
      estimate.costUsd += positiveNumber(step.costUsd);
      estimate.durationMs += positiveNumber(step.durationMs);
      return estimate;
    },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, durationMs: 0 }
  );
}

export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatEstimateDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}
