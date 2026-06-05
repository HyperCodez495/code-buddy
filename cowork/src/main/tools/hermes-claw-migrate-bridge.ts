import { loadCoreModule } from '../utils/core-loader';

export type ClawMigrationAction = 'import' | 'archive' | 'skip' | 'conflict';
export type ClawMigrationPreset = 'full' | 'user-data';
export type SkillConflictMode = 'skip' | 'overwrite' | 'rename';

export interface ClawMigrationEntry {
  action: ClawMigrationAction;
  applied?: boolean;
  category: string;
  destination: string | null;
  detail: string;
  error?: string;
  label: string;
  source: string | null;
}

export interface ClawMigrationReport {
  applied: boolean;
  backupPath: string | null;
  detected: boolean;
  dryRun: boolean;
  entries: ClawMigrationEntry[];
  kind: 'hermes_claw_migration';
  migrateSecrets: boolean;
  notes: string[];
  openClawHome: string | null;
  preset: ClawMigrationPreset;
  schemaVersion: 1;
  summary: {
    appliedCount: number;
    archive: number;
    conflict: number;
    failedCount: number;
    import: number;
    skip: number;
    total: number;
  };
  workspaceTarget: string;
}

export interface ClawMigrationRunOptions {
  migrateSecrets?: boolean;
  overwrite?: boolean;
  preset?: ClawMigrationPreset;
  skillConflict?: SkillConflictMode;
  source?: string;
  workspaceTarget?: string;
}

interface HermesClawMigrateModule {
  runClawMigration: (options: Record<string, unknown>) => Promise<ClawMigrationReport>;
}

/**
 * Dry-run preview of an OpenClaw → Code Buddy migration. NEVER writes.
 * Mirrors `buddy hermes claw status` (and `claw migrate` without `--apply`).
 */
export async function getHermesClawStatusForReview(
  options: { source?: string; preset?: ClawMigrationPreset } = {},
): Promise<ClawMigrationReport | null> {
  const mod = await loadCoreModule<HermesClawMigrateModule>('agent/hermes-claw-migrate.js');
  if (!mod?.runClawMigration) return null;

  return mod.runClawMigration({
    apply: false,
    preset: options.preset,
    source: options.source,
  });
}

/**
 * Actually perform the OpenClaw migration (apply=true). Only call after an
 * explicit, confirmed user action in the UI. Mirrors `buddy hermes claw migrate --apply`.
 */
export async function runHermesClawMigrationForReview(
  options: ClawMigrationRunOptions,
): Promise<{ error?: string; ok: boolean; report?: ClawMigrationReport }> {
  const mod = await loadCoreModule<HermesClawMigrateModule>('agent/hermes-claw-migrate.js');
  if (!mod?.runClawMigration) {
    return { error: 'Core Hermes OpenClaw migration module is unavailable.', ok: false };
  }

  const report = await mod.runClawMigration({
    apply: true,
    backup: true,
    migrateSecrets: options.migrateSecrets === true,
    overwrite: options.overwrite === true,
    preset: options.preset,
    skillConflict: options.skillConflict,
    source: options.source,
    workspaceTarget: options.workspaceTarget,
  });

  return { ok: report.summary.failedCount === 0, report };
}
