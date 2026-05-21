import { describe, expect, it } from 'vitest';

import {
  HERMES_NATIVE_SURFACES,
  buildHermesAgentProfile,
  buildHermesIntegrationPlan,
  buildHermesAgentSystemPrompt,
  renderHermesIntegrationPlanMarkdown,
} from '../../src/agent/hermes-agent-profile.js';

describe('Hermes Agent profile', () => {
  it('maps Hermes concepts onto native Code Buddy surfaces', () => {
    const profile = buildHermesAgentProfile('review');

    expect(profile.id).toBe('hermes');
    expect(profile.defaultDispatchProfile).toBe('review');
    expect(profile.dispatchProfileGuidance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ profile: 'review', useWhen: expect.stringContaining('read-first') }),
      ]),
    );
    expect(profile.nativeSurfaces.map((surface) => surface.id)).toEqual(
      HERMES_NATIVE_SURFACES.map((surface) => surface.id),
    );
    expect(profile.nativeSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'toolsets', codeBuddySurface: expect.stringContaining('buddy fleet toolsets') }),
        expect.objectContaining({ id: 'skills', codeBuddySurface: expect.stringContaining('SKILL.md') }),
        expect.objectContaining({ id: 'lessons', codeBuddySurface: expect.stringContaining('lessons_graph') }),
        expect.objectContaining({ id: 'hooks', codeBuddySurface: expect.stringContaining('buddy hermes hooks') }),
        expect.objectContaining({ id: 'delegation', codeBuddySurface: expect.stringContaining('peer_delegate') }),
      ]),
    );
  });

  it('includes resolver-backed Fleet toolsets for every dispatch profile', () => {
    const profile = buildHermesAgentProfile();

    expect(profile.toolsets.map((toolset) => toolset.toolsetId)).toEqual([
      'fleet.hermes.balanced',
      'fleet.hermes.research',
      'fleet.hermes.code',
      'fleet.hermes.review',
      'fleet.hermes.safe',
    ]);
    expect(profile.toolsets.find((toolset) => toolset.profile === 'safe')?.deniedTools).toEqual(
      expect.arrayContaining(['create_file', 'bash', 'delete_file']),
    );
  });

  it('builds the system prompt used by the built-in custom agent', () => {
    const prompt = buildHermesAgentSystemPrompt('safe');

    expect(prompt).toContain('You are Hermes Agent inside Code Buddy.');
    expect(prompt).toContain('Default Fleet toolset: fleet.hermes.safe');
    expect(prompt).toContain('Dispatch profile selection:');
    expect(prompt).toContain('safe: high-risk');
    expect(prompt).toContain('Do not pretend to be the external Hermes Python runtime');
    expect(prompt).toContain('Use skills for repeatable procedures');
    expect(prompt).toContain('lessons_graph');
    expect(prompt).toContain('session search');
  });

  it('builds a practical integration checklist for Hermes setup', () => {
    const plan = buildHermesIntegrationPlan('safe');

    expect(plan.id).toBe('hermes-integration-plan');
    expect(plan.planSchemaVersion).toBe(1);
    expect(plan.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(plan.summary).toContain('toolset-aware');
    expect(plan.dispatchProfile).toBe('safe');
    expect(plan.toolsetId).toBe('fleet.hermes.safe');
    expect(plan.recommendedNextCommand).toBe('buddy hermes doctor safe --json');
    expect(plan.surfaceIds).toEqual(['toolsets', 'delegation', 'lessons']);
    expect(plan.interactionSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cli',
          entrypoint: 'buddy hermes plan safe --json',
          produces: expect.arrayContaining(['stable JSON plan']),
        }),
        expect.objectContaining({
          id: 'cowork',
          entrypoint: 'Fleet Command Center Hermes plan strip',
          consumes: expect.arrayContaining(['toolset fleet.hermes.safe']),
        }),
        expect.objectContaining({
          id: 'shared-json',
          primaryAction: expect.stringContaining('same structured contract'),
        }),
      ]),
    );
    expect(plan.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'export-lessons-vault',
          kind: 'prepare',
          risk: 'local-write',
          nativeSurfaceId: 'lessons',
          expectedArtifacts: expect.arrayContaining([
            '.codebuddy/lessons-vault/manifest.json',
          ]),
          acceptanceCriteria: expect.arrayContaining([
            expect.stringContaining('manifest.json'),
          ]),
          command: expect.stringContaining('buddy lessons graph --no-keywords --vault'),
        }),
        expect.objectContaining({
          id: 'verify-agent',
          kind: 'verify',
          risk: 'read-only',
          expectedArtifacts: [],
          acceptanceCriteria: expect.arrayContaining([
            expect.stringContaining('Diagnostics return ok'),
          ]),
          command: expect.stringContaining('buddy hermes doctor safe --json'),
        }),
      ]),
    );
  });

  it('renders the Hermes integration checklist as Markdown', () => {
    const markdown = renderHermesIntegrationPlanMarkdown(buildHermesIntegrationPlan('safe'));

    expect(markdown).toContain('# Hermes Integration Plan (safe)');
    expect(markdown).toContain('- Plan schema version: `1`');
    expect(markdown).toContain('- Generated: `');
    expect(markdown).toContain('- Toolset: `fleet.hermes.safe`');
    expect(markdown).toContain('- Recommended next command: `buddy hermes doctor safe --json`');
    expect(markdown).toContain('## Interaction Surfaces');
    expect(markdown).toContain('### CLI');
    expect(markdown).toContain('- Entrypoint: `buddy hermes plan safe --json`');
    expect(markdown).toContain('### Cowork');
    expect(markdown).toContain('Fleet Command Center');
    expect(markdown).toContain('## Checklist');
    expect(markdown).toContain('### Export a navigable lessons vault');
    expect(markdown).toContain('- Kind: `prepare`');
    expect(markdown).toContain('- Risk: `local-write`');
    expect(markdown).toContain('- Expected artifacts:');
    expect(markdown).toContain('  - `.codebuddy/lessons-vault/manifest.json`');
    expect(markdown).toContain('- Acceptance criteria:');
    expect(markdown).toContain('  - The generated vault includes a manifest.json file.');
    expect(markdown).toContain('- Command: `buddy lessons graph --no-keywords --vault .codebuddy/lessons-vault`');
  });
});
