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
  it('reports registered adapters and the two out-of-scope Python providers', () => {
    for (const key of [
      'CODEBUDDY_MEMORY_PROVIDER',
      'MEM0_API_KEY', 'MEM0_BASE_URL',
      'HONCHO_API_KEY', 'HONCHO_BASE_URL',
      'SUPERMEMORY_API_KEY', 'SUPERMEMORY_BASE_URL',
      'OPENVIKING_ENDPOINT', 'OPENVIKING_API_KEY',
      'RETAINDB_API_KEY', 'RETAINDB_BASE_URL',
    ]) {
      delete process.env[key];
    }
    resetMemoryProviderRegistry();

    const readiness = buildHermesMemoryProvidersReadiness({
      now: () => new Date('2026-05-31T12:00:00.000Z'),
    });

    expect(readiness.generatedAt).toBe('2026-05-31T12:00:00.000Z');
    expect(readiness.ok).toBe(true);
    expect(readiness.activeProviderId).toBe('local');
    // local + mem0 + honcho + supermemory + openviking + retaindb + byterover
    expect(readiness.registeredCount).toBe(7);
    expect(readiness.configuredRemoteCount).toBe(0);
    expect(readiness.configuredRemoteProviderIds).toEqual([]);
    expect(readiness.fallbackCount).toBe(6);
    expect(readiness.fallbackProviderIds).toEqual([
      'honcho',
      'openviking',
      'mem0',
      'retaindb',
      'byterover',
      'supermemory',
    ]);
    // The only "missing" providers are intentionally out of native-TS scope.
    expect(readiness.missingOfficialCount).toBe(0);
    expect(readiness.missingOfficialProviderIds).toEqual([]);
    expect(readiness.outOfScopeCount).toBe(2);
    expect(readiness.outOfScopeProviderIds).toEqual(['hindsight', 'holographic']);
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
      registered: true,
      status: 'fallback',
    });
    expect(readiness.providers.find((provider) => provider.id === 'holographic')).toMatchObject({
      registered: false,
      outOfScope: true,
    });
    expect(readiness.recommendations.join('\n')).toContain('Out of native-TS scope');
    const rendered = renderHermesMemoryProvidersReadiness(readiness);
    expect(rendered).toContain('Configured remote: 0 (none)');
    expect(rendered).toContain('Local-fallback adapters: 6 (honcho, openviking, mem0, retaindb, byterover, supermemory)');
    expect(rendered).toContain('Missing official adapters: 0 (none)');
    expect(rendered).toContain('Out of native-TS scope: 2 (hindsight, holographic)');
    expect(rendered).toContain('out-of-scope holographic');
  });

  it('marks a configured remote provider without leaking credential values', () => {
    for (const key of ['OPENVIKING_ENDPOINT', 'OPENVIKING_API_KEY', 'RETAINDB_API_KEY', 'HONCHO_API_KEY', 'HONCHO_BASE_URL', 'SUPERMEMORY_API_KEY']) {
      delete process.env[key];
    }
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
    expect(readiness.fallbackProviderIds).toEqual(['honcho', 'openviking', 'retaindb', 'byterover', 'supermemory']);
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
