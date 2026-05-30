import path from 'path';
import {
  SkillsHub,
  type InstalledSkill,
  type SkillHistoryResult,
  type SkillLifecycleState,
} from '../skills/hub.js';

export type HermesSkillPackageStatus = 'active' | 'disabled' | 'deprecated';

export interface HermesSkillPackageEntry {
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
  source: InstalledSkill['source'];
  status: HermesSkillPackageStatus;
  successCount?: number;
  version: string;
}

export interface HermesSkillPackageSummary {
  cacheDir: string;
  disabledCount: number;
  enabledCount: number;
  installedCount: number;
  lockfilePath: string;
  packages: HermesSkillPackageEntry[];
  reviewCommands: string[];
  rollbackableCount: number;
  skillRoot: string;
}

export interface HermesSkillPackageSummaryOptions {
  limit?: number;
}

export function buildHermesSkillPackageSummary(
  workDir: string = process.cwd(),
  options: HermesSkillPackageSummaryOptions = {},
): HermesSkillPackageSummary {
  const root = path.resolve(workDir);
  const lockfilePath = path.join(root, '.codebuddy', 'skills-lock.json');
  const skillRoot = path.join(root, '.codebuddy', 'skills');
  const cacheDir = path.join(root, '.codebuddy', 'skills-cache');
  const hub = new SkillsHub({
    cacheDir,
    lockfilePath,
    skillsDir: skillRoot,
  });
  const allPackages = hub
    .list()
    .map((skill) => summarizeInstalledSkill(skill, hub.getInstalledSkillHistory(skill.name)))
    .sort((left, right) =>
      statusRank(left.status) - statusRank(right.status)
      || right.installedAt - left.installedAt
      || left.name.localeCompare(right.name),
    );
  const packages = allPackages.slice(0, normalizeLimit(options.limit));

  return {
    cacheDir,
    disabledCount: allPackages.filter((skill) => !skill.enabled).length,
    enabledCount: allPackages.filter((skill) => skill.enabled).length,
    installedCount: allPackages.length,
    lockfilePath,
    packages,
    reviewCommands: [
      'buddy skills list --all --json',
      'buddy skills learning-usage --json',
      'Use skill_manage with approved_by for enable/disable/deprecate/patch/rollback/update.',
    ],
    rollbackableCount: allPackages.reduce((total, skill) => total + skill.rollbackableCount, 0),
    skillRoot,
  };
}

function summarizeInstalledSkill(
  skill: InstalledSkill,
  history: SkillHistoryResult | null,
): HermesSkillPackageEntry {
  const lifecycle = skill.lifecycle;
  const usage = skill.usage;
  const enabled = skill.enabled !== false;

  return {
    ...(typeof usage?.averageDurationMs === 'number' ? { averageDurationMs: usage.averageDurationMs } : {}),
    enabled,
    ...(typeof usage?.failureCount === 'number' ? { failureCount: usage.failureCount } : {}),
    installedAt: skill.installedAt,
    integrityOk: history?.current.integrityOk ?? false,
    ...(typeof usage?.invocationCount === 'number' ? { invocationCount: usage.invocationCount } : {}),
    ...(usage?.lastError ? { lastError: usage.lastError } : {}),
    ...(lifecycle?.reason ? { lastLifecycleReason: lifecycle.reason } : {}),
    ...(lifecycle?.updatedBy ? { lastLifecycleReviewer: lifecycle.updatedBy } : {}),
    ...(typeof usage?.lastUsedAt === 'number' ? { lastUsedAt: usage.lastUsedAt } : {}),
    name: skill.name,
    path: skill.path,
    rollbackableCount: history?.rollbackableCount ?? 0,
    source: skill.source,
    status: lifecycleStatus(skill, lifecycle),
    ...(typeof usage?.successCount === 'number' ? { successCount: usage.successCount } : {}),
    version: skill.version,
  };
}

function lifecycleStatus(
  skill: InstalledSkill,
  lifecycle: SkillLifecycleState | undefined,
): HermesSkillPackageStatus {
  if (lifecycle?.status === 'deprecated') return 'deprecated';
  if (skill.enabled === false) return 'disabled';
  return 'active';
}

function statusRank(status: HermesSkillPackageStatus): number {
  if (status === 'deprecated') return 0;
  if (status === 'disabled') return 1;
  return 2;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(100, Math.max(1, Math.trunc(value as number)));
}
