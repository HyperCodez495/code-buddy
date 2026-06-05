import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import { getHermesDoctorForReview } from '../src/main/tools/hermes-doctor-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

function diagnostics(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    agentName: 'Hermes',
    dispatchProfile: 'balanced',
    source: 'built-in',
    enabledTools: ['view_file', 'search'],
    disabledTools: ['bash'],
    providerReadiness: { ok: true },
    runtimeBackends: { ok: true },
    browserBackends: { ok: false },
    promptChecks: { ok: true },
    issues: [],
    recommendations: ['All good.'],
    ...overrides,
  };
}

describe('Hermes doctor bridge', () => {
  it('rolls up aggregate diagnostics into per-area readiness', async () => {
    mockedLoadCoreModule.mockResolvedValue({
      buildHermesAgentDiagnostics: () => diagnostics(),
    });

    const review = await getHermesDoctorForReview();
    expect(review).not.toBeNull();
    expect(review?.ok).toBe(true);
    expect(review?.agentName).toBe('Hermes');
    expect(review?.dispatchProfile).toBe('balanced');
    expect(review?.enabledToolCount).toBe(2);
    expect(review?.disabledToolCount).toBe(1);
    expect(review?.command).toBe('buddy hermes doctor --json');
    const browser = review?.areas.find((a) => a.id === 'browser');
    expect(browser?.ok).toBe(false);
    const providers = review?.areas.find((a) => a.id === 'providers');
    expect(providers?.ok).toBe(true);
  });

  it('treats undefined promptChecks.ok as healthy', async () => {
    mockedLoadCoreModule.mockResolvedValue({
      buildHermesAgentDiagnostics: () => diagnostics({ promptChecks: {} }),
    });
    const review = await getHermesDoctorForReview();
    expect(review?.areas.find((a) => a.id === 'prompt')?.ok).toBe(true);
  });

  it('returns null when the core module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);
    expect(await getHermesDoctorForReview()).toBeNull();
  });
});
