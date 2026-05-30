import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import { listSkillPackagesForReview } from '../src/main/tools/skill-package-manager-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('skill package manager bridge', () => {
  it('loads installed skill package summary from the workspace root', async () => {
    const buildHermesSkillPackageSummary = vi.fn(() => ({
      cacheDir: 'D:/workspace/.codebuddy/skills-cache',
      disabledCount: 1,
      enabledCount: 1,
      installedCount: 2,
      lockfilePath: 'D:/workspace/.codebuddy/skills-lock.json',
      packages: [
        {
          enabled: true,
          exists: true,
          installedAt: 1,
          integrityOk: true,
          name: 'audit-helper',
          path: 'D:/workspace/.codebuddy/skills/audit-helper/SKILL.md',
          rollbackableCount: 1,
          source: 'local',
          status: 'active',
          version: '1.0.0',
        },
      ],
      reviewCommands: ['buddy skills list --all --json'],
      rollbackableCount: 1,
      skillRoot: 'D:/workspace/.codebuddy/skills',
    }));
    mockedLoadCoreModule.mockResolvedValue({ buildHermesSkillPackageSummary });

    const rootDir = path.resolve('workspace');
    const summary = await listSkillPackagesForReview({
      rootDir,
      limit: 5,
    });

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('agent/hermes-skill-package-summary.js');
    expect(buildHermesSkillPackageSummary).toHaveBeenCalledWith(rootDir, { limit: 5 });
    expect(summary?.installedCount).toBe(2);
    expect(summary?.packages[0]?.name).toBe('audit-helper');
  });

  it('rejects relative roots before loading the core module', async () => {
    const summary = await listSkillPackagesForReview({
      rootDir: 'relative-workspace',
    });

    expect(summary).toBeNull();
    expect(mockedLoadCoreModule).not.toHaveBeenCalled();
  });
});
