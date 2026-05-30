import { isAbsolute, resolve } from 'path';
import { loadCoreModule } from '../utils/core-loader';

type HermesSkillPackageStatus = 'active' | 'disabled' | 'deprecated';

export interface SkillPackageManagerEntry {
  averageDurationMs?: number;
  enabled: boolean;
  failureCount?: number;
  installedAt: number;
  integrityOk: boolean;
  invocationCount?: number;
  lastError?: string;
  lastLifecycleReason?: string;
  lastLifecycleReviewer?: string;
  lastUsedAt?: number;
  name: string;
  path: string;
  rollbackableCount: number;
  source: 'hub' | 'local' | 'git';
  status: HermesSkillPackageStatus;
  successCount?: number;
  version: string;
}

export interface SkillPackageManagerSummary {
  cacheDir: string;
  disabledCount: number;
  enabledCount: number;
  installedCount: number;
  lockfilePath: string;
  packages: SkillPackageManagerEntry[];
  reviewCommands: string[];
  rollbackableCount: number;
  skillRoot: string;
}

export interface ListSkillPackagesForReviewOptions {
  limit?: number;
  rootDir: string;
}

interface HermesSkillPackageModule {
  buildHermesSkillPackageSummary: (
    workDir: string,
    options?: { limit?: number },
  ) => SkillPackageManagerSummary;
}

export async function listSkillPackagesForReview(
  options: ListSkillPackagesForReviewOptions,
): Promise<SkillPackageManagerSummary | null> {
  const rootDir = normalizeAbsoluteRoot(options.rootDir);
  if (!rootDir) return null;

  const mod = await loadCoreModule<HermesSkillPackageModule>('agent/hermes-skill-package-summary.js');
  if (!mod?.buildHermesSkillPackageSummary) return null;

  return mod.buildHermesSkillPackageSummary(rootDir, {
    limit: normalizeLimit(options.limit),
  });
}

function normalizeAbsoluteRoot(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  return isAbsolute(trimmed) ? resolve(trimmed) : null;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(100, Math.max(1, Math.trunc(value as number)));
}
