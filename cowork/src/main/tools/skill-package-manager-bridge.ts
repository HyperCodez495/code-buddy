import { isAbsolute, resolve } from 'path';
import { loadCoreModule } from '../utils/core-loader';

type HermesSkillPackageStatus = 'active' | 'disabled' | 'deprecated';
export type SkillPackageLifecycleAction = 'enable' | 'disable' | 'deprecate';

export interface SkillPackageManagerEntry {
  averageDurationMs?: number;
  contentPreview?: string;
  contentPreviewTruncated?: boolean;
  enabled: boolean;
  exists: boolean;
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
  sizeBytes?: number;
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

export interface SetSkillPackageLifecycleForReviewOptions {
  action: SkillPackageLifecycleAction;
  approvedBy: string;
  name: string;
  reason?: string;
  rootDir: string;
}

export interface SetSkillPackageLifecycleForReviewResult {
  package: SkillPackageManagerEntry;
  summary: SkillPackageManagerSummary;
}

interface HermesSkillPackageModule {
  buildHermesSkillPackageSummary: (
    workDir: string,
    options?: { limit?: number },
  ) => SkillPackageManagerSummary;
  setHermesSkillPackageLifecycle?: (
    workDir: string,
    skillName: string,
    action: SkillPackageLifecycleAction,
    options: { actor: string; reason?: string },
  ) => SkillPackageManagerEntry | null;
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

export async function setSkillPackageLifecycleForReview(
  options: SetSkillPackageLifecycleForReviewOptions,
): Promise<SetSkillPackageLifecycleForReviewResult> {
  const rootDir = normalizeAbsoluteRoot(options.rootDir);
  if (!rootDir) {
    throw new Error('An absolute workspace root is required to manage a skill package.');
  }

  const approvedBy = options.approvedBy.trim();
  if (!approvedBy) {
    throw new Error('approvedBy is required to manage a skill package from Cowork.');
  }

  const name = options.name.trim();
  if (!name) {
    throw new Error('name is required to manage a skill package from Cowork.');
  }

  if (!['enable', 'disable', 'deprecate'].includes(options.action)) {
    throw new Error(`Unsupported skill package lifecycle action: ${options.action}`);
  }

  const mod = await loadCoreModule<HermesSkillPackageModule>('agent/hermes-skill-package-summary.js');
  if (!mod?.setHermesSkillPackageLifecycle || !mod.buildHermesSkillPackageSummary) {
    throw new Error('Core skill package lifecycle module is unavailable.');
  }

  const updated = mod.setHermesSkillPackageLifecycle(rootDir, name, options.action, {
    actor: approvedBy,
    reason: options.reason?.trim() || undefined,
  });
  if (!updated) {
    throw new Error(`Skill package not found: ${name}`);
  }

  return {
    package: updated,
    summary: mod.buildHermesSkillPackageSummary(rootDir, { limit: 20 }),
  };
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
