import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function runHermesJson(args: string[]): unknown {
  const result = spawnSync(process.execPath, [tsxCli, 'src/index.ts', 'hermes', ...args, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 90_000,
    windowsHide: true,
  });

  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toMatch(/^\{/);
  return JSON.parse(result.stdout) as unknown;
}

describe('Hermes CLI status real smoke', () => {
  it('runs the status command matrix through the real CLI entrypoint', () => {
    const doctor = runHermesJson(['doctor', 'safe']) as {
      diagnostics: {
        activeToolset: { toolsetId: string };
        ok: boolean;
        providerReadiness: { activeModel: { model: string }; providers: unknown[] };
        runtimeBackends: { backends: unknown[]; runnableCount: number };
      };
      requestedProfile: string;
    };
    expect(doctor.requestedProfile).toBe('safe');
    expect(doctor.diagnostics.ok).toBe(true);
    expect(doctor.diagnostics.activeToolset.toolsetId).toBe('fleet.hermes.safe');
    expect(doctor.diagnostics.providerReadiness.activeModel.model).toBeTruthy();
    expect(doctor.diagnostics.providerReadiness.providers.length).toBeGreaterThan(0);
    expect(doctor.diagnostics.runtimeBackends.backends.length).toBeGreaterThan(0);
    expect(doctor.diagnostics.runtimeBackends.runnableCount).toBeGreaterThanOrEqual(1);

    const toolsets = runHermesJson(['toolsets', 'safe']) as {
      activeProfile: string;
      activeToolset: { toolsetId: string };
      kind: string;
      summary: { totalToolsets: number };
      toolsets: Array<{ toolsetId: string }>;
    };
    expect(toolsets.kind).toBe('hermes_toolsets_catalog');
    expect(toolsets.activeProfile).toBe('safe');
    expect(toolsets.activeToolset.toolsetId).toBe('fleet.hermes.safe');
    expect(toolsets.summary.totalToolsets).toBe(5);
    expect(toolsets.toolsets.map((toolset) => toolset.toolsetId)).toContain('fleet.hermes.review');

    const tools = runHermesJson(['tools']) as {
      kind: string;
      summary: { exact: number; gaps: number; total: number };
    };
    expect(tools.kind).toBe('hermes_official_tool_parity_manifest');
    expect(tools.summary.total).toBeGreaterThanOrEqual(70);
    expect(tools.summary.exact).toBeGreaterThan(0);
    expect(tools.summary.gaps).toBe(0);

    const portal = runHermesJson(['portal', 'status']) as {
      kind: string;
      portal: { defaultPortalUrl: string };
      toolGateway: { tools: unknown[] };
    };
    expect(portal.kind).toBe('hermes_portal_status');
    expect(portal.portal.defaultPortalUrl).toBe('https://portal.nousresearch.com');
    expect(portal.toolGateway.tools.length).toBeGreaterThan(0);

    const promptSize = runHermesJson(['prompt-size', 'safe']) as {
      kind: string;
      sections: Array<{ id: string }>;
      toolsetId: string;
      totals: { bytes: number };
    };
    expect(promptSize.kind).toBe('hermes_prompt_size_diagnostic');
    expect(promptSize.toolsetId).toBe('fleet.hermes.safe');
    expect(promptSize.totals.bytes).toBeGreaterThan(0);
    expect(promptSize.sections.map((section) => section.id)).toEqual(
      expect.arrayContaining(['systemPrompt', 'toolset', 'toolSchemas'])
    );
  });
});
