import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import {
  deleteSkillPackageForReview,
  listSkillPackagesForReview,
  patchSkillPackageForReview,
  rollbackSkillPackageForReview,
  resetSkillPackageForReview,
  setSkillPackageLifecycleForReview,
  updateSkillPackageForReview,
} from '../src/main/tools/skill-package-manager-bridge';

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

  it('applies reviewer-gated lifecycle actions through the core package summary module', async () => {
    const setHermesSkillPackageLifecycle = vi.fn(() => ({
      enabled: false,
      exists: true,
      installedAt: 1,
      integrityOk: true,
      lastLifecycleReason: 'Paused during review.',
      lastLifecycleReviewer: 'Patrice',
      name: 'audit-helper',
      path: 'D:/workspace/.codebuddy/skills/audit-helper/SKILL.md',
      rollbackableCount: 0,
      source: 'local',
      status: 'disabled',
      version: '1.0.0',
    }));
    const buildHermesSkillPackageSummary = vi.fn(() => ({
      cacheDir: 'D:/workspace/.codebuddy/skills-cache',
      disabledCount: 1,
      enabledCount: 0,
      installedCount: 1,
      lockfilePath: 'D:/workspace/.codebuddy/skills-lock.json',
      packages: [],
      reviewCommands: ['buddy skills list --all --json'],
      rollbackableCount: 0,
      skillRoot: 'D:/workspace/.codebuddy/skills',
    }));
    mockedLoadCoreModule.mockResolvedValue({
      buildHermesSkillPackageSummary,
      setHermesSkillPackageLifecycle,
    });

    const rootDir = path.resolve('workspace');
    const result = await setSkillPackageLifecycleForReview({
      action: 'disable',
      approvedBy: 'Patrice',
      name: 'audit-helper',
      reason: 'Paused during review.',
      rootDir,
    });

    expect(setHermesSkillPackageLifecycle).toHaveBeenCalledWith(rootDir, 'audit-helper', 'disable', {
      actor: 'Patrice',
      reason: 'Paused during review.',
    });
    expect(result).toMatchObject({
      package: {
        lastLifecycleReviewer: 'Patrice',
        name: 'audit-helper',
        status: 'disabled',
      },
      summary: {
        disabledCount: 1,
      },
    });
  });

  it('requires reviewer identity before package lifecycle changes', async () => {
    await expect(setSkillPackageLifecycleForReview({
      action: 'disable',
      approvedBy: ' ',
      name: 'audit-helper',
      rootDir: path.resolve('workspace'),
    })).rejects.toThrow('approvedBy is required');

    expect(mockedLoadCoreModule).not.toHaveBeenCalled();
  });

  it('rolls back a package through the core package summary module', async () => {
    const rollbackHermesSkillPackage = vi.fn(() => ({
      enabled: true,
      exists: true,
      installedAt: 1,
      integrityOk: true,
      lastLifecycleReason: 'Restore snapshot.',
      lastLifecycleReviewer: 'Patrice',
      name: 'audit-helper',
      path: 'D:/workspace/.codebuddy/skills/audit-helper/SKILL.md',
      rollbackableCount: 2,
      source: 'local',
      status: 'active',
      version: '1.0.0',
    }));
    const buildHermesSkillPackageSummary = vi.fn(() => ({
      cacheDir: 'D:/workspace/.codebuddy/skills-cache',
      disabledCount: 0,
      enabledCount: 1,
      installedCount: 1,
      lockfilePath: 'D:/workspace/.codebuddy/skills-lock.json',
      packages: [],
      reviewCommands: ['buddy skills list --all --json'],
      rollbackableCount: 2,
      skillRoot: 'D:/workspace/.codebuddy/skills',
    }));
    mockedLoadCoreModule.mockResolvedValue({
      buildHermesSkillPackageSummary,
      rollbackHermesSkillPackage,
    });

    const rootDir = path.resolve('workspace');
    const result = await rollbackSkillPackageForReview({
      approvedBy: 'Patrice',
      name: 'audit-helper',
      reason: 'Restore snapshot.',
      rootDir,
      snapshotId: 'snapshot-1',
    });

    expect(rollbackHermesSkillPackage).toHaveBeenCalledWith(rootDir, 'audit-helper', {
      actor: 'Patrice',
      reason: 'Restore snapshot.',
      snapshotId: 'snapshot-1',
    });
    expect(result).toMatchObject({
      package: {
        lastLifecycleReviewer: 'Patrice',
        name: 'audit-helper',
        rollbackableCount: 2,
        status: 'active',
      },
      summary: {
        rollbackableCount: 2,
      },
    });
  });

  it('deletes a package through the core package summary module', async () => {
    const deleteHermesSkillPackage = vi.fn().mockResolvedValue(true);
    const buildHermesSkillPackageSummary = vi.fn(() => ({
      cacheDir: 'D:/workspace/.codebuddy/skills-cache',
      disabledCount: 0,
      enabledCount: 0,
      installedCount: 0,
      lockfilePath: 'D:/workspace/.codebuddy/skills-lock.json',
      packages: [],
      reviewCommands: ['buddy skills list --all --json'],
      rollbackableCount: 0,
      skillRoot: 'D:/workspace/.codebuddy/skills',
    }));
    mockedLoadCoreModule.mockResolvedValue({
      buildHermesSkillPackageSummary,
      deleteHermesSkillPackage,
    });

    const rootDir = path.resolve('workspace');
    const result = await deleteSkillPackageForReview({
      approvedBy: 'Patrice',
      name: 'obsolete-helper',
      reason: 'Obsolete after review.',
      rootDir,
    });

    expect(deleteHermesSkillPackage).toHaveBeenCalledWith(rootDir, 'obsolete-helper', {
      actor: 'Patrice',
      reason: 'Obsolete after review.',
    });
    expect(result).toMatchObject({
      deletedName: 'obsolete-helper',
      summary: {
        installedCount: 0,
      },
    });
  });

  it('updates a package through the core package summary module', async () => {
    const updateHermesSkillPackage = vi.fn().mockResolvedValue({
      enabled: true,
      exists: true,
      installedAt: 1,
      integrityOk: true,
      lastLifecycleReason: 'Use cached hub update.',
      lastLifecycleReviewer: 'Patrice',
      name: 'cached-helper',
      path: 'D:/workspace/.codebuddy/skills/cached-helper/SKILL.md',
      rollbackableCount: 1,
      source: 'hub',
      status: 'active',
      version: '0.2.0',
    });
    const buildHermesSkillPackageSummary = vi.fn(() => ({
      cacheDir: 'D:/workspace/.codebuddy/skills-cache',
      disabledCount: 0,
      enabledCount: 1,
      installedCount: 1,
      lockfilePath: 'D:/workspace/.codebuddy/skills-lock.json',
      packages: [],
      reviewCommands: ['buddy skills list --all --json'],
      rollbackableCount: 1,
      skillRoot: 'D:/workspace/.codebuddy/skills',
    }));
    mockedLoadCoreModule.mockResolvedValue({
      buildHermesSkillPackageSummary,
      updateHermesSkillPackage,
    });

    const rootDir = path.resolve('workspace');
    const result = await updateSkillPackageForReview({
      approvedBy: 'Patrice',
      name: 'cached-helper',
      reason: 'Use cached hub update.',
      rootDir,
      version: '0.2.0',
    });

    expect(updateHermesSkillPackage).toHaveBeenCalledWith(rootDir, 'cached-helper', {
      actor: 'Patrice',
      force: undefined,
      reason: 'Use cached hub update.',
      version: '0.2.0',
    });
    expect(result).toMatchObject({
      package: {
        lastLifecycleReviewer: 'Patrice',
        name: 'cached-helper',
        version: '0.2.0',
      },
      summary: {
        rollbackableCount: 1,
      },
    });
  });

  it('resets a package through the core package summary module', async () => {
    const resetHermesSkillPackage = vi.fn().mockResolvedValue({
      contentPreview: 'Canonical cache content.',
      enabled: true,
      exists: true,
      installedAt: 1,
      integrityOk: true,
      lastLifecycleReason: 'Restore canonical cache.',
      lastLifecycleReviewer: 'Patrice',
      name: 'reset-helper',
      path: 'D:/workspace/.codebuddy/skills/reset-helper/SKILL.md',
      rollbackableCount: 1,
      source: 'hub',
      status: 'active',
      version: '0.1.0',
    });
    const buildHermesSkillPackageSummary = vi.fn(() => ({
      cacheDir: 'D:/workspace/.codebuddy/skills-cache',
      disabledCount: 0,
      enabledCount: 1,
      installedCount: 1,
      lockfilePath: 'D:/workspace/.codebuddy/skills-lock.json',
      packages: [],
      reviewCommands: ['buddy skills list --all --json'],
      rollbackableCount: 1,
      skillRoot: 'D:/workspace/.codebuddy/skills',
    }));
    mockedLoadCoreModule.mockResolvedValue({
      buildHermesSkillPackageSummary,
      resetHermesSkillPackage,
    });

    const rootDir = path.resolve('workspace');
    const result = await resetSkillPackageForReview({
      approvedBy: 'Patrice',
      name: 'reset-helper',
      reason: 'Restore canonical cache.',
      rootDir,
      version: '0.1.0',
    });

    expect(resetHermesSkillPackage).toHaveBeenCalledWith(rootDir, 'reset-helper', {
      actor: 'Patrice',
      reason: 'Restore canonical cache.',
      version: '0.1.0',
    });
    expect(result).toMatchObject({
      package: {
        integrityOk: true,
        lastLifecycleReviewer: 'Patrice',
        name: 'reset-helper',
      },
      summary: {
        rollbackableCount: 1,
      },
    });
  });

  it('patches a package through the core package summary module', async () => {
    const patchHermesSkillPackage = vi.fn(() => ({
      contentPreview: 'Reviewed patch wording.',
      enabled: true,
      exists: true,
      installedAt: 1,
      integrityOk: true,
      lastLifecycleReason: 'Review exact wording.',
      lastLifecycleReviewer: 'Patrice',
      name: 'patch-helper',
      path: 'D:/workspace/.codebuddy/skills/patch-helper/SKILL.md',
      rollbackableCount: 1,
      source: 'local',
      status: 'active',
      version: '1.0.0',
    }));
    const buildHermesSkillPackageSummary = vi.fn(() => ({
      cacheDir: 'D:/workspace/.codebuddy/skills-cache',
      disabledCount: 0,
      enabledCount: 1,
      installedCount: 1,
      lockfilePath: 'D:/workspace/.codebuddy/skills-lock.json',
      packages: [],
      reviewCommands: ['buddy skills list --all --json'],
      rollbackableCount: 1,
      skillRoot: 'D:/workspace/.codebuddy/skills',
    }));
    mockedLoadCoreModule.mockResolvedValue({
      buildHermesSkillPackageSummary,
      patchHermesSkillPackage,
    });

    const rootDir = path.resolve('workspace');
    const result = await patchSkillPackageForReview({
      approvedBy: 'Patrice',
      expectedReplacements: 1,
      name: 'patch-helper',
      newText: 'Reviewed patch wording.',
      oldText: 'Original patch wording.',
      reason: 'Review exact wording.',
      rootDir,
    });

    expect(patchHermesSkillPackage).toHaveBeenCalledWith(rootDir, 'patch-helper', {
      actor: 'Patrice',
      expectedReplacements: 1,
      newText: 'Reviewed patch wording.',
      oldText: 'Original patch wording.',
      reason: 'Review exact wording.',
    });
    expect(result).toMatchObject({
      package: {
        lastLifecycleReviewer: 'Patrice',
        name: 'patch-helper',
        rollbackableCount: 1,
      },
      summary: {
        rollbackableCount: 1,
      },
    });
  });
});
