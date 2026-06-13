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

export async function exportHermesTrajectoriesBatch(options?: {
  includeArtifactContent?: boolean;
  limit?: number;
  maxArtifactBytes?: number;
  maxCompressedBytes?: number;
  maxEventValueBytes?: number;
  query?: string;
  runIds?: string[];
  sources?: string[];
}): Promise<{ success: boolean; data?: string; error?: string }> {
  const mod = await loadCoreModule<Record<string, any>>('observability/run-trajectory-batch.js');
  if (!mod?.buildRunTrajectoryBatchExport) return { success: false, error: 'Module missing' };

  try {
    const batch = mod.buildRunTrajectoryBatchExport({
      includeArtifactContent: options?.includeArtifactContent === true,
      limit: options?.limit,
      maxArtifactBytes: options?.maxArtifactBytes,
      maxCompressedBytes: options?.maxCompressedBytes,
      maxEventValueBytes: options?.maxEventValueBytes,
      query: options?.query,
      runIds: options?.runIds,
      sources: options?.sources,
    });
    return { success: true, data: JSON.stringify(batch, null, 2) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
