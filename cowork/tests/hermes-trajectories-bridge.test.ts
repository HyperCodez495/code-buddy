import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import { getHermesTrajectoriesForReview } from '../src/main/tools/hermes-trajectories-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('Hermes trajectories bridge', () => {
  it('summarizes trajectory compatibility capabilities', async () => {
    mockedLoadCoreModule.mockResolvedValue({
      buildHermesTrajectoryCompatibilityReport: () => ({
        generatedAt: '2026-06-05T10:00:00.000Z',
        ok: true,
        summary: {
          total: 3,
          availableCount: 3,
          partialCount: 0,
          missingCount: 0,
          goldenFixtureCount: 5,
          policyEvalCount: 4,
        },
        capabilities: [
          {
            id: 'trajectory-export',
            label: 'Redacted trajectory export',
            officialSurface: 'Export a complete trajectory',
            status: 'available',
            commands: ['buddy run trajectory-export <run-id> --json'],
            notes: [],
          },
        ],
        recommendations: ['Trajectories ready.'],
      }),
    });

    const review = await getHermesTrajectoriesForReview();
    expect(review).not.toBeNull();
    expect(review?.ok).toBe(true);
    expect(review?.total).toBe(3);
    expect(review?.availableCount).toBe(3);
    expect(review?.goldenFixtureCount).toBe(5);
    expect(review?.policyEvalCount).toBe(4);
    expect(review?.command).toBe('buddy hermes trajectories status --json');
    expect(review?.capabilities[0]?.id).toBe('trajectory-export');
  });

  it('returns null when the core module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);
    expect(await getHermesTrajectoriesForReview()).toBeNull();
  });
});
