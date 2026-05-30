import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import { getHermesToolCatalogForReview } from '../src/main/tools/hermes-tool-catalog-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('Hermes tool catalog bridge', () => {
  it('summarizes the official Hermes tool parity manifest for Cowork review', async () => {
    mockedLoadCoreModule.mockResolvedValue({
      buildLocalHermesToolParityManifest: () => ({
        generatedAt: '2026-05-30T16:30:00.000Z',
        officialSource: {
          inspectedCommit: '5f84c914',
          repository: 'https://github.com/NousResearch/hermes-agent',
        },
        codeBuddySource: {
          localToolCount: 120,
        },
        summary: {
          exact: 22,
          gaps: 33,
          nativeEquivalent: 6,
          partial: 10,
          total: 71,
        },
        tools: [
          {
            category: 'skills',
            name: 'skill_manage',
            nextWork: 'Expose Cowork lifecycle controls.',
            notes: 'Partial lifecycle.',
            status: 'partial',
            toolset: 'hermes-core',
          },
          {
            category: 'runtime',
            name: 'execute_code',
            nextWork: 'Make a product/security decision.',
            notes: 'Missing exact RPC collapse.',
            status: 'partial',
            toolset: 'hermes-core',
          },
          {
            category: 'platform',
            name: 'spotify_play',
            notes: 'Optional platform connector.',
            status: 'gap',
            toolset: 'spotify',
          },
        ],
      }),
    });

    const summary = await getHermesToolCatalogForReview();

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('agent/hermes-tool-parity-local.js');
    expect(summary).toEqual({
      generatedAt: '2026-05-30T16:30:00.000Z',
      inspectedCommit: '5f84c914',
      localToolCount: 120,
      source: 'https://github.com/NousResearch/hermes-agent',
      summary: {
        exact: 22,
        gaps: 33,
        nativeEquivalent: 6,
        partial: 10,
        total: 71,
      },
      topWork: [
        {
          category: 'skills',
          name: 'skill_manage',
          nextWork: 'Expose Cowork lifecycle controls.',
          status: 'partial',
          toolset: 'hermes-core',
        },
        {
          category: 'runtime',
          name: 'execute_code',
          nextWork: 'Make a product/security decision.',
          status: 'partial',
          toolset: 'hermes-core',
        },
        {
          category: 'platform',
          name: 'spotify_play',
          status: 'gap',
          toolset: 'spotify',
        },
      ],
    });
  });

  it('degrades to null when the core parity module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    await expect(getHermesToolCatalogForReview()).resolves.toBeNull();
  });
});
