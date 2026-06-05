import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader';
import {
  getHermesMemoryProvidersForReview,
  runHermesMemoryProbeForReview,
} from '../src/main/tools/hermes-memory-providers-bridge';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('Hermes memory providers bridge', () => {
  it('summarizes memory provider readiness without leaking credential values', async () => {
    mockedLoadCoreModule.mockResolvedValue({
      buildHermesMemoryProvidersReadiness: () => ({
        activeProviderId: 'mem0',
        configuredRemoteCount: 1,
        fallbackCount: 2,
        generatedAt: '2026-05-31T12:00:00.000Z',
        issues: [],
        missingOfficialCount: 5,
        ok: true,
        providers: [
          {
            active: true,
            baseUrlSources: ['MEM0_BASE_URL'],
            configured: true,
            credentialSources: ['MEM0_API_KEY'],
            id: 'mem0',
            label: 'Mem0',
            local: false,
            notes: [],
            officialSurface: 'Mem0 external memory provider',
            registered: true,
            remediation: [],
            status: 'configured',
          },
        ],
        recommendations: ['Missing official Hermes memory adapters: OpenViking.'],
        registeredCount: 4,
      }),
    });

    const summary = await getHermesMemoryProvidersForReview();

    expect(mockedLoadCoreModule).toHaveBeenCalledWith('agent/hermes-memory-providers.js');
    expect(summary).toMatchObject({
      activeProviderId: 'mem0',
      command: 'buddy hermes memory status --json',
      configuredRemoteCount: 1,
      fallbackCount: 2,
      missingOfficialCount: 5,
      ok: true,
      providers: [
        {
          credentialSources: ['MEM0_API_KEY'],
          status: 'configured',
        },
      ],
      registeredCount: 4,
    });
    expect(JSON.stringify(summary)).not.toContain('secret-mem0-token');
    expect(JSON.stringify(summary)).not.toContain('https://memory.example.test');
  });

  it('degrades to null when the core memory module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);

    await expect(getHermesMemoryProvidersForReview()).resolves.toBeNull();
  });
});

describe('Hermes memory probe bridge', () => {
  it('runs a live write→read probe and surfaces the verdict without secrets', async () => {
    const probeMemoryProvider = vi.fn().mockResolvedValue({
      kind: 'hermes_memory_probe',
      schemaVersion: 1,
      generatedAt: '2026-06-05T10:00:00.000Z',
      providerId: 'mem0',
      activeProviderId: 'mem0',
      remote: true,
      wrote: true,
      retrieved: true,
      fellBackToLocal: false,
      retrievedSample: 'HERMES-PROBE-MARKER',
      verdict: 'pass',
      ok: true,
      notes: ['Round-trip succeeded.'],
    });
    mockedLoadCoreModule.mockResolvedValue({ probeMemoryProvider });

    const response = await runHermesMemoryProbeForReview('mem0');
    expect(probeMemoryProvider).toHaveBeenCalledWith('mem0');
    expect(response.ok).toBe(true);
    expect(response.result?.verdict).toBe('pass');
    expect(response.result?.wrote).toBe(true);
    expect(response.result?.retrieved).toBe(true);
  });

  it('returns an error response when the probe module is unavailable', async () => {
    mockedLoadCoreModule.mockResolvedValue(null);
    const response = await runHermesMemoryProbeForReview('mem0');
    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/unavailable/i);
  });
});
