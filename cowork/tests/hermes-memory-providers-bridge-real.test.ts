import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getHermesMemoryProvidersForReview } from '../src/main/tools/hermes-memory-providers-bridge';

const distRoot = path.resolve(process.cwd(), '..', 'dist');
const hasBuiltMemoryCore = fs.existsSync(path.join(distRoot, 'agent', 'hermes-memory-providers.js'));

const envKeys = [
  'CODEBUDDY_ENGINE_PATH',
  'CODEBUDDY_MEMORY_PROVIDER',
  'HONCHO_API_KEY',
  'HONCHO_BASE_URL',
  'MEM0_API_KEY',
  'MEM0_BASE_URL',
  'SUPERMEMORY_API_KEY',
  'SUPERMEMORY_BASE_URL',
] as const;

type EnvKey = typeof envKeys[number];

describe.skipIf(!hasBuiltMemoryCore)('Hermes memory providers bridge real core integration', () => {
  let originalEnv: Partial<Record<EnvKey, string | undefined>>;

  beforeEach(() => {
    originalEnv = Object.fromEntries(
      envKeys.map((key) => [key, process.env[key]])
    ) as Partial<Record<EnvKey, string | undefined>>;
    for (const key of envKeys) {
      delete process.env[key];
    }

    process.env.CODEBUDDY_ENGINE_PATH = distRoot;
    process.env.CODEBUDDY_MEMORY_PROVIDER = 'mem0';
    process.env.MEM0_API_KEY = 'secret-mem0-token';
    process.env.MEM0_BASE_URL = 'https://memory.example.test/private';
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('loads the real compiled memory provider matrix without leaking credentials', async () => {
    const summary = await getHermesMemoryProvidersForReview();
    const mem0 = summary?.providers.find((provider) => provider.id === 'mem0');

    expect(summary).toMatchObject({
      activeProviderId: 'mem0',
      command: 'buddy hermes memory status --json',
      ok: true,
    });
    expect(summary?.registeredCount).toBeGreaterThan(0);
    expect(summary?.configuredRemoteCount).toBeGreaterThanOrEqual(1);
    expect(summary?.missingOfficialCount).toBeGreaterThan(0);
    expect(summary?.providers.map((provider) => provider.id)).toEqual(
      expect.arrayContaining(['local', 'honcho', 'openviking', 'mem0', 'supermemory']),
    );
    expect(mem0).toMatchObject({
      active: true,
      baseUrlSources: ['MEM0_BASE_URL'],
      configured: true,
      credentialSources: ['MEM0_API_KEY'],
      label: 'Mem0',
      registered: true,
      status: 'configured',
    });
    expect(JSON.stringify(summary)).not.toContain('secret-mem0-token');
    expect(JSON.stringify(summary)).not.toContain('https://memory.example.test/private');
  });
});
