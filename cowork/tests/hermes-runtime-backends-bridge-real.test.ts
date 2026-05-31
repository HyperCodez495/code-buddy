import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getHermesRuntimeBackendsForReview,
  runHermesRuntimeBackendSmokeForReview,
} from '../src/main/tools/hermes-runtime-backends-bridge';

const distRoot = path.resolve(process.cwd(), '..', 'dist');
const hasBuiltRuntimeCore =
  fs.existsSync(path.join(distRoot, 'agent', 'hermes-agent-diagnostics.js')) &&
  fs.existsSync(path.join(distRoot, 'agent', 'hermes-runtime-backends.js'));

const envKeys = [
  'CODEBUDDY_ENGINE_PATH',
  'CODEBUDDY_REMOTE_HOST',
  'CODEBUDDY_SSH_HOST',
  'DAYTONA_API_KEY',
  'DAYTONA_PROFILE',
  'DAYTONA_SERVER_URL',
  'MODAL_PROFILE',
  'MODAL_TOKEN_ID',
  'MODAL_TOKEN_SECRET',
  'SSH_HOST',
  'VERCEL_ORG_ID',
  'VERCEL_TEAM_ID',
  'VERCEL_TOKEN',
] as const;

type EnvKey = typeof envKeys[number];

describe.skipIf(!hasBuiltRuntimeCore)('Hermes runtime backends bridge real core integration', () => {
  let originalEnv: Partial<Record<EnvKey, string | undefined>>;

  beforeEach(() => {
    originalEnv = Object.fromEntries(
      envKeys.map((key) => [key, process.env[key]])
    ) as Partial<Record<EnvKey, string | undefined>>;
    for (const key of envKeys) {
      delete process.env[key];
    }

    process.env.CODEBUDDY_ENGINE_PATH = distRoot;
    process.env.MODAL_TOKEN_ID = 'secret-modal-id';
    process.env.MODAL_TOKEN_SECRET = 'secret-modal-secret';
    process.env.VERCEL_TOKEN = 'secret-vercel-token';
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('loads the real compiled runtime matrix and runs a local smoke without leaking credentials', async () => {
    const summary = await getHermesRuntimeBackendsForReview();
    const local = summary?.backends.find((backend) => backend.id === 'local');
    const modal = summary?.backends.find((backend) => backend.id === 'modal');
    const vercel = summary?.backends.find((backend) => backend.id === 'vercel-sandbox');
    const smoke = await runHermesRuntimeBackendSmokeForReview(' local ');

    expect(summary).toMatchObject({
      arch: expect.any(String),
      command: 'buddy hermes doctor balanced --json',
      platform: expect.any(String),
    });
    expect(summary?.backends.map((backend) => backend.id)).toEqual(
      expect.arrayContaining(['local', 'docker', 'ssh', 'modal', 'daytona', 'vercel-sandbox']),
    );
    expect(summary?.availableCount).toBeGreaterThanOrEqual(1);
    expect(summary?.runnableCount).toBeGreaterThanOrEqual(1);
    expect(local).toMatchObject({
      id: 'local',
      installed: true,
      label: 'Local process',
      runnable: true,
      status: 'available',
    });
    expect(local?.smokeCommand).toContain('OK-HERMES-LOCAL');
    expect(modal?.credentialSources).toEqual(
      expect.arrayContaining(['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET']),
    );
    expect(vercel?.credentialSources).toEqual(['VERCEL_TOKEN']);
    expect(smoke).toMatchObject({
      backendId: 'local',
      ok: true,
      output: 'OK-HERMES-LOCAL',
      status: 'passed',
    });
    expect(JSON.stringify(summary)).not.toContain('secret-modal-id');
    expect(JSON.stringify(summary)).not.toContain('secret-modal-secret');
    expect(JSON.stringify(summary)).not.toContain('secret-vercel-token');
    expect(JSON.stringify(smoke)).not.toContain('secret-modal-id');
    expect(JSON.stringify(smoke)).not.toContain('secret-modal-secret');
    expect(JSON.stringify(smoke)).not.toContain('secret-vercel-token');
  });
});
