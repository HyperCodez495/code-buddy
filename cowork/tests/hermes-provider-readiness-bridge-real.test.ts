import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getHermesProviderReadinessForReview } from '../src/main/tools/hermes-provider-readiness-bridge';

const distRoot = path.resolve(process.cwd(), '..', 'dist');
const hasBuiltProviderCore =
  fs.existsSync(path.join(distRoot, 'agent', 'hermes-agent-diagnostics.js')) &&
  fs.existsSync(path.join(distRoot, 'agent', 'hermes-portal-status.js'));

const envKeys = [
  'ANTHROPIC_API_KEY',
  'BROWSERBASE_API_KEY',
  'BROWSER_USE_API_KEY',
  'BRAVE_API_KEY',
  'CODEBUDDY_AUDIOREADER_URL',
  'CODEBUDDY_BROWSER_CDP_URL',
  'CODEBUDDY_ENGINE_PATH',
  'CODEBUDDY_IMAGE_API_KEY',
  'CODEBUDDY_MODEL',
  'CODEBUDDY_MODAL_TOKEN',
  'CODEBUDDY_NOUS_ACCESS_TOKEN',
  'CODEBUDDY_NOUS_AUTH_FILE',
  'CODEBUDDY_NOUS_MANAGED_TOOLS',
  'CODEBUDDY_NOUS_TOOL_GATEWAY',
  'CODEBUDDY_NOUS_TOOL_GATEWAY_URL',
  'CODEBUDDY_PROVIDER',
  'CODEBUDDY_TTS_PROVIDER',
  'FAL_KEY',
  'FIRECRAWL_API_KEY',
  'GEMINI_API_KEY',
  'GROK_API_KEY',
  'GROK_MODEL',
  'MODAL_TOKEN_ID',
  'MODAL_TOKEN_SECRET',
  'NOUS_TOOL_GATEWAY_URL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'PERPLEXITY_API_KEY',
  'SERPER_API_KEY',
  'XAI_API_KEY',
] as const;

type EnvKey = typeof envKeys[number];

describe.skipIf(!hasBuiltProviderCore)('Hermes provider readiness bridge real core integration', () => {
  let originalEnv: Partial<Record<EnvKey, string | undefined>>;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-hermes-provider-'));
    originalEnv = Object.fromEntries(
      envKeys.map((key) => [key, process.env[key]])
    ) as Partial<Record<EnvKey, string | undefined>>;
    for (const key of envKeys) {
      delete process.env[key];
    }

    process.env.CODEBUDDY_ENGINE_PATH = distRoot;
    process.env.CODEBUDDY_MODEL = 'gpt-4o';
    process.env.OPENAI_API_KEY = 'secret-openai-key';
    process.env.CODEBUDDY_NOUS_ACCESS_TOKEN = 'secret-nous-token';
    process.env.CODEBUDDY_NOUS_TOOL_GATEWAY = '1';
    process.env.CODEBUDDY_NOUS_MANAGED_TOOLS = 'web,image_gen';
    process.env.CODEBUDDY_NOUS_AUTH_FILE = path.join(tempDir, 'missing-nous-auth.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('loads the real compiled provider diagnostics without leaking credentials', async () => {
    const summary = await getHermesProviderReadinessForReview();

    expect(summary).toMatchObject({
      activeModel: {
        model: 'gpt-4o',
        provider: 'openai',
        source: 'environment model',
        supportsToolCalls: true,
        supportsVision: true,
      },
      activeProvider: {
        configured: true,
        credentialSources: expect.arrayContaining(['OPENAI_API_KEY']),
        label: 'OpenAI / Codex-compatible',
      },
      command: 'buddy hermes providers status --json',
      ok: true,
      portal: {
        credentialPresent: true,
        credentialSources: ['CODEBUDDY_NOUS_ACCESS_TOKEN'],
        directFallbackCount: 2,
        managedByNousCount: 2,
        toolGatewayConfigured: true,
      },
    });
    expect(summary?.providerCount).toBeGreaterThan(0);
    expect(summary?.configuredProviderCount).toBeGreaterThan(0);
    expect(Number.isFinite(summary?.portal.directFallbackCount)).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('secret-openai-key');
    expect(JSON.stringify(summary)).not.toContain('secret-nous-token');
  });
});
