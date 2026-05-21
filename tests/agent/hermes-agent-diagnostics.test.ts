import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { CustomAgentLoader } from '../../src/agent/custom/custom-agent-loader.js';
import { buildHermesAgentDiagnostics } from '../../src/agent/hermes-agent-diagnostics.js';

let tempDir: string | null = null;

function makeTempDir(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hermes-doctor-'));
  return tempDir;
}

describe('Hermes Agent diagnostics', () => {
  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('reports the built-in Hermes Agent and its defensive tool filter', () => {
    const loader = new CustomAgentLoader(makeTempDir());
    const diagnostics = buildHermesAgentDiagnostics({
      dispatchProfile: 'safe',
      loader,
    });

    expect(diagnostics.ok).toBe(true);
    expect(diagnostics.source).toBe('built-in');
    expect(diagnostics.activeToolset.toolsetId).toBe('fleet.hermes.safe');
    expect(diagnostics.fleetDispatchProfile).toBe('balanced');
    expect(diagnostics.requireExplicitDispatchProfile).toBe(true);
    expect(diagnostics.effectiveToolFilter.enabledPatterns).toEqual(['view_file', 'web_search', 'web_fetch']);
    expect(diagnostics.effectiveToolFilter.disabledPatterns).toEqual([
      'create_file',
      'bash',
      'git_push',
      'delete_file',
    ]);
    expect(diagnostics.dispatchProfileGuidance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ profile: 'safe', useWhen: expect.stringContaining('high-risk') }),
        expect.objectContaining({ profile: 'review', useWhen: expect.stringContaining('read-first') }),
      ]),
    );
    expect(diagnostics.nativeSurfaceIds).toEqual(
      expect.arrayContaining(['toolsets', 'skills', 'memory', 'delegation']),
    );
  });

  it('detects a user override while keeping the diagnostic non-fatal', () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, 'hermes.toml'),
      [
        'name = "Local Hermes"',
        'description = "Project override"',
        'systemPrompt = """',
        'Code Buddy Hermes local prompt.',
        '"""',
        '',
      ].join('\n'),
    );
    const loader = new CustomAgentLoader(dir);
    const diagnostics = buildHermesAgentDiagnostics({ loader });

    expect(diagnostics.ok).toBe(true);
    expect(diagnostics.source).toBe('user');
    expect(diagnostics.userOverride).toBe(true);
    expect(diagnostics.agentName).toBe('Local Hermes');
    expect(diagnostics.recommendations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('external Python runtime'),
        expect.stringContaining('disabledTools'),
      ]),
    );
  });
});
