import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import { listSkillCandidatesForReview } from '../src/main/tools/skill-candidate-review-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('skill candidate review bridge', () => {
  it('loads eligible materialized research-script skill candidates from the workspace root', async () => {
    const listMaterializedResearchScriptSkillCandidates = vi.fn(async () => [
      {
        eligible: false,
        id: 'candidate-old',
        reason: '1/2 successful runs.',
        skillName: 'research-old',
        skillPath: '.codebuddy/skill-candidates/research-old/SKILL.md',
        sourceJobId: 'research-script-old',
        successfulRunCount: 1,
        title: 'Old candidate',
      },
      {
        eligible: true,
        id: 'candidate-ready',
        reason: '2 successful runs met the promotion threshold.',
        skillName: 'research-ready',
        skillPath: '.codebuddy/skill-candidates/research-ready/SKILL.md',
        sourceJobId: 'research-script-ready',
        successfulRunCount: 2,
        title: 'Ready candidate',
      },
    ]);
    mockedLoadCoreModule.mockResolvedValue({ listMaterializedResearchScriptSkillCandidates });

    const rootDir = path.resolve('workspace');
    const candidates = await listSkillCandidatesForReview({
      rootDir,
      eligibleOnly: true,
      skillRoot: '.codebuddy/skill-candidates',
    });

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('agent/research-script-skill-candidate.js');
    expect(listMaterializedResearchScriptSkillCandidates).toHaveBeenCalledWith({
      rootDir,
      skillRoot: '.codebuddy/skill-candidates',
    });
    expect(candidates).toEqual([
      {
        eligible: true,
        id: 'candidate-ready',
        reason: '2 successful runs met the promotion threshold.',
        skillName: 'research-ready',
        skillPath: '.codebuddy/skill-candidates/research-ready/SKILL.md',
        sourceJobId: 'research-script-ready',
        successfulRunCount: 2,
        title: 'Ready candidate',
      },
    ]);
  });

  it('degrades to an empty queue when the core candidate module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    await expect(listSkillCandidatesForReview({
      rootDir: path.resolve('workspace'),
    })).resolves.toEqual([]);
  });

  it('rejects relative workspace roots before loading the core module', async () => {
    const candidates = await listSkillCandidatesForReview({
      rootDir: 'relative-workspace',
    });

    expect(candidates).toEqual([]);
    expect(mockedLoadCoreModule).not.toHaveBeenCalled();
  });
});
