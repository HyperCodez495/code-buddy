import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import { getHermesPortalForReview } from '../src/main/tools/hermes-portal-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

function sampleStatus(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-06-05T10:00:00.000Z',
    portal: {
      authFilePresent: true,
      credentialPresent: true,
      credentialSources: ['nous-auth.json'],
      docsUrl: 'https://hermes-agent.nousresearch.com/docs',
      loggedIn: true,
      portalBaseUrl: 'https://portal.nousresearch.com',
      selectedInferenceProvider: 'nous',
      selectedModel: 'hermes-4',
      selectedViaNous: true,
      subscriptionUrl: 'https://portal.nousresearch.com/manage-subscription',
      toolGatewayConfigured: true,
      toolGatewayUrl: 'https://gateway.nousresearch.com',
    },
    toolGateway: {
      configuredCount: 2,
      managedByNousCount: 1,
      notConfiguredCount: 0,
      routingActive: true,
      tools: [
        {
          configured: true,
          credentialEnv: ['FIRECRAWL_API_KEY'],
          currentProvider: 'firecrawl',
          key: 'web',
          label: 'Web search',
          managedByNous: false,
          notes: [],
          partner: 'Firecrawl',
        },
      ],
    },
    notes: ['Portal is ready.'],
    ...overrides,
  };
}

describe('Hermes portal bridge', () => {
  it('summarizes portal readiness without leaking secret values', async () => {
    mockedLoadCoreModule.mockResolvedValue({
      buildHermesPortalStatus: () => sampleStatus(),
    });

    const review = await getHermesPortalForReview();
    expect(review).not.toBeNull();
    expect(review?.ok).toBe(true);
    expect(review?.loggedIn).toBe(true);
    expect(review?.configuredToolCount).toBe(2);
    expect(review?.managedByNousCount).toBe(1);
    expect(review?.notConfiguredToolCount).toBe(0);
    expect(review?.routingActive).toBe(true);
    expect(review?.command).toBe('buddy hermes portal status --json');
    expect(review?.portal.credentialSources).toEqual(['nous-auth.json']);
    expect(review?.tools[0]?.partner).toBe('Firecrawl');
    // No secret values — only env source *names*.
    const serialized = JSON.stringify(review);
    expect(serialized).not.toContain('access_token');
    expect(serialized).not.toContain('Bearer ');
  });

  it('marks ok=false when logged out and a gateway tool is unconfigured', async () => {
    mockedLoadCoreModule.mockResolvedValue({
      buildHermesPortalStatus: () =>
        sampleStatus({
          portal: { ...sampleStatus().portal, loggedIn: false },
          toolGateway: { ...sampleStatus().toolGateway, notConfiguredCount: 1 },
        }),
    });

    const review = await getHermesPortalForReview();
    expect(review?.ok).toBe(false);
  });

  it('returns null when the core module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);
    expect(await getHermesPortalForReview()).toBeNull();
  });
});
