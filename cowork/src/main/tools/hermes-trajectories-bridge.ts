import { loadCoreModule } from '../utils/core-loader';

export type HermesTrajectoryCapabilityStatus = 'available' | 'partial' | 'missing';

export interface HermesTrajectoryCapabilityReviewItem {
  commands: string[];
  id: string;
  label: string;
  notes: string[];
  officialSurface: string;
  status: HermesTrajectoryCapabilityStatus;
}

export interface HermesTrajectoriesReview {
  availableCount: number;
  capabilities: HermesTrajectoryCapabilityReviewItem[];
  command: string;
  generatedAt: string;
  goldenFixtureCount: number;
  missingCount: number;
  ok: boolean;
  partialCount: number;
  policyEvalCount: number;
  recommendations: string[];
  total: number;
}

interface HermesTrajectoryCompatibilityModule {
  buildHermesTrajectoryCompatibilityReport: (options?: Record<string, unknown>) => {
    generatedAt: string;
    ok: boolean;
    summary: {
      total: number;
      availableCount: number;
      partialCount: number;
      missingCount: number;
      goldenFixtureCount: number;
      policyEvalCount: number;
    };
    capabilities: HermesTrajectoryCapabilityReviewItem[];
    recommendations: string[];
  };
}

/**
 * Read-only review of Hermes research-trajectory compatibility for Cowork.
 * Mirrors `buddy hermes trajectories status --json` (without a runId/query
 * probe, so it stays cheap and side-effect free).
 */
export async function getHermesTrajectoriesForReview(): Promise<HermesTrajectoriesReview | null> {
  const mod = await loadCoreModule<HermesTrajectoryCompatibilityModule>(
    'observability/hermes-trajectory-compatibility.js',
  );
  if (!mod?.buildHermesTrajectoryCompatibilityReport) return null;

  const report = mod.buildHermesTrajectoryCompatibilityReport();
  return {
    availableCount: report.summary.availableCount,
    capabilities: report.capabilities.map((capability) => ({
      commands: capability.commands,
      id: capability.id,
      label: capability.label,
      notes: capability.notes,
      officialSurface: capability.officialSurface,
      status: capability.status,
    })),
    command: 'buddy hermes trajectories status --json',
    generatedAt: report.generatedAt,
    goldenFixtureCount: report.summary.goldenFixtureCount,
    missingCount: report.summary.missingCount,
    ok: report.ok,
    partialCount: report.summary.partialCount,
    policyEvalCount: report.summary.policyEvalCount,
    recommendations: report.recommendations,
    total: report.summary.total,
  };
}
