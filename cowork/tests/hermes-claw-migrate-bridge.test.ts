import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import {
  getHermesClawStatusForReview,
  runHermesClawMigrationForReview,
} from '../src/main/tools/hermes-claw-migrate-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

function report(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'hermes_claw_migration',
    schemaVersion: 1,
    detected: true,
    openClawHome: '/home/u/.openclaw',
    workspaceTarget: '/home/u/project',
    preset: 'user-data',
    migrateSecrets: false,
    dryRun: true,
    applied: false,
    backupPath: null,
    entries: [
      {
        category: 'persona',
        label: 'Persona / SOUL',
        action: 'import',
        source: '/home/u/.openclaw/soul.md',
        destination: 'SOUL.md',
        detail: 'Imports persona',
      },
    ],
    summary: { import: 1, archive: 0, skip: 0, conflict: 0, appliedCount: 0, failedCount: 0, total: 1 },
    notes: [],
    ...overrides,
  };
}

describe('Hermes claw migrate bridge', () => {
  it('returns a dry-run preview without applying (apply=false)', async () => {
    const runClawMigration = vi.fn().mockResolvedValue(report());
    mockedLoadCoreModule.mockResolvedValue({ runClawMigration });

    const result = await getHermesClawStatusForReview({ preset: 'user-data' });
    expect(runClawMigration).toHaveBeenCalledWith(
      expect.objectContaining({ apply: false, preset: 'user-data' }),
    );
    expect(result?.detected).toBe(true);
    expect(result?.dryRun).toBe(true);
    expect(result?.summary.import).toBe(1);
  });

  it('applies the migration only with apply=true and reports failure count', async () => {
    const runClawMigration = vi.fn().mockResolvedValue(
      report({
        dryRun: false,
        applied: true,
        summary: { import: 1, archive: 0, skip: 0, conflict: 0, appliedCount: 1, failedCount: 0, total: 1 },
      }),
    );
    mockedLoadCoreModule.mockResolvedValue({ runClawMigration });

    const response = await runHermesClawMigrationForReview({ preset: 'full', overwrite: true });
    expect(runClawMigration).toHaveBeenCalledWith(
      expect.objectContaining({ apply: true, overwrite: true, preset: 'full' }),
    );
    expect(response.ok).toBe(true);
    expect(response.report?.applied).toBe(true);
  });

  it('returns an error response when the module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);
    expect(await getHermesClawStatusForReview()).toBeNull();
    const response = await runHermesClawMigrationForReview({});
    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/unavailable/i);
  });
});
