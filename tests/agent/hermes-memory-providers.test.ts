import { afterEach, describe, expect, it } from 'vitest';

import {
  buildHermesMemoryProvidersReadiness,
  renderHermesMemoryProvidersReadiness,
} from '../../src/agent/hermes-memory-providers.js';
import { resetMemoryProviderRegistry } from '../../src/memory/memory-provider.js';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

afterEach(() => {
  restoreEnv();
  resetMemoryProviderRegistry();
});

describe('Hermes memory provider readiness', () => {
  it('reports the real registered providers and missing official Hermes adapters', () => {
    delete process.env.CODEBUDDY_MEMORY_PROVIDER;
    delete process.env.MEM0_API_KEY;
    delete process.env.HONCHO_API_KEY;
    delete process.env.SUPERMEMORY_API_KEY;
    resetMemoryProviderRegistry();

    const readiness = buildHermesMemoryProvidersReadiness({
      now: () => new Date('2026-05-31T12:00:00.000Z'),
    });

    expect(readiness.generatedAt).toBe('2026-05-31T12:00:00.000Z');
    expect(readiness.ok).toBe(true);
    expect(readiness.activeProviderId).toBe('local');
    expect(readiness.registeredCount).toBe(4);
    expect(readiness.configuredRemoteCount).toBe(0);
    expect(readiness.configuredRemoteProviderIds).toEqual([]);
    expect(readiness.fallbackCount).toBe(3);
    expect(readiness.fallbackProviderIds).toEqual(['honcho', 'mem0', 'supermemory']);
    expect(readiness.missingOfficialCount).toBe(5);
    expect(readiness.missingOfficialProviderIds).toEqual([
      'openviking',
      'hindsight',
      'holographic',
      'retaindb',
      'byterover',
    ]);
    expect(readiness.providers.find((provider) => provider.id === 'local')).toMatchObject({
      active: true,
      registered: true,
      status: 'available',
    });
    expect(readiness.providers.find((provider) => provider.id === 'mem0')).toMatchObject({
      registered: true,
      status: 'fallback',
    });
    expect(readiness.providers.find((provider) => provider.id === 'byterover')).toMatchObject({
      registered: false,
      status: 'missing',
    });
    expect(readiness.recommendations.join('\n')).toContain('OpenViking');
    const rendered = renderHermesMemoryProvidersReadiness(readiness);
    expect(rendered).toContain('Configured remote: 0 (none)');
    expect(rendered).toContain('Local-fallback adapters: 3 (honcho, mem0, supermemory)');
    expect(rendered).toContain('Missing official adapters: 5 (openviking, hindsight, holographic, retaindb, byterover)');
    expect(rendered).toContain('Remediation: Set MEM0_API_KEY before relying on the Mem0 remote adapter.');
    expect(rendered).toContain('Remediation: Add a ByteRover adapter before claiming full Hermes memory-provider parity.');
  });

  it('marks a configured remote provider without leaking credential values', () => {
    process.env.CODEBUDDY_MEMORY_PROVIDER = 'mem0';
    process.env.MEM0_API_KEY = 'secret-mem0-token';
    process.env.MEM0_BASE_URL = 'https://memory.example.test';
    resetMemoryProviderRegistry();

    const readiness = buildHermesMemoryProvidersReadiness();
    const active = readiness.providers.find((provider) => provider.id === 'mem0');

    expect(readiness.ok).toBe(true);
    expect(readiness.activeProviderId).toBe('mem0');
    expect(readiness.configuredRemoteCount).toBe(1);
    expect(readiness.configuredRemoteProviderIds).toEqual(['mem0']);
    expect(readiness.fallbackProviderIds).toEqual(['honcho', 'supermemory']);
    expect(active).toMatchObject({
      active: true,
      configured: true,
      credentialSources: ['MEM0_API_KEY'],
      baseUrlSources: ['MEM0_BASE_URL'],
      status: 'configured',
    });
    expect(JSON.stringify(readiness)).toContain('MEM0_API_KEY');
    expect(JSON.stringify(readiness)).not.toContain('secret-mem0-token');
    expect(JSON.stringify(readiness)).not.toContain('memory.example.test');
  });

  it('flags an active remote adapter that would silently fall back to local memory', () => {
    process.env.CODEBUDDY_MEMORY_PROVIDER = 'honcho';
    delete process.env.HONCHO_API_KEY;
    resetMemoryProviderRegistry();

    const readiness = buildHermesMemoryProvidersReadiness();
    const rendered = renderHermesMemoryProvidersReadiness(readiness);

    expect(readiness.ok).toBe(false);
    expect(readiness.issues[0]).toContain('Honcho');
    expect(readiness.issues[0]).toContain('fall back to local memory');
    expect(rendered).toContain('* fallback   honcho');
  });

  it('reports an invalid active provider selection', () => {
    process.env.CODEBUDDY_MEMORY_PROVIDER = 'missing-memory';
    resetMemoryProviderRegistry();

    const readiness = buildHermesMemoryProvidersReadiness();

    expect(readiness.ok).toBe(false);
    expect(readiness.activeProviderId).toBe('local');
    expect(readiness.issues[0]).toContain('CODEBUDDY_MEMORY_PROVIDER points to unknown provider');
  });
});
