import { describe, expect, it } from 'vitest';

import {
  buildHermesToolsetCatalog,
  listCatalogMemberToolNames,
  OFFICIAL_HERMES_TOOLSET_IDS,
  type HermesToolsetCatalogManifest,
} from '../../src/agent/hermes-toolset-catalog.js';
import { collectOfflineBuiltinToolNames } from '../../src/agent/hermes-tool-parity-local.js';
import { buildHermesToolParityManifest } from '../../src/agent/hermes-tool-parity-manifest.js';

const GENERATED_AT = '2026-06-04T00:00:00.000Z';

function buildLocalCatalog(): HermesToolsetCatalogManifest {
  return buildHermesToolsetCatalog(collectOfflineBuiltinToolNames(), GENERATED_AT);
}

describe('Hermes official toolset catalog', () => {
  it('enumerates the official named toolsets grouped core/composite/platform/dynamic', () => {
    const catalog = buildLocalCatalog();

    expect(catalog.kind).toBe('hermes_official_toolset_catalog');
    expect(catalog.summary.totalOfficialToolsets).toBe(OFFICIAL_HERMES_TOOLSET_IDS.length);
    expect(catalog.toolsets).toHaveLength(OFFICIAL_HERMES_TOOLSET_IDS.length);

    // The named toolsets called out by the parity work must all be present.
    const ids = catalog.toolsets.map((toolset) => toolset.id);
    for (const required of [
      'web',
      'search',
      'terminal',
      'file',
      'browser',
      'vision',
      'image_gen',
      'moa',
      'skills',
      'tts',
      'todo',
      'memory',
      'session_search',
      'cronjob',
      'code_execution',
      'delegation',
      'clarify',
      'homeassistant',
      'messaging',
      'spotify',
      'discord',
      'discord_admin',
      'debugging',
      'safe',
      'rl',
      'hermes-cli',
      'hermes-discord',
      'hermes-feishu',
    ]) {
      expect(ids).toContain(required);
    }

    // Every catalog group is populated.
    expect(catalog.summary.byGroup.core).toBeGreaterThan(0);
    expect(catalog.summary.byGroup.composite).toBeGreaterThan(0);
    expect(catalog.summary.byGroup.platform).toBeGreaterThan(0);
    expect(catalog.summary.byGroup.dynamic).toBeGreaterThan(0);
    const groupTotal =
      catalog.summary.byGroup.core +
      catalog.summary.byGroup.composite +
      catalog.summary.byGroup.platform +
      catalog.summary.byGroup.dynamic;
    expect(groupTotal).toBe(catalog.summary.totalOfficialToolsets);
  });

  it('computes per-toolset readiness from the real built-in tools', () => {
    const catalog = buildLocalCatalog();

    const present = catalog.summary.present;
    const partial = catalog.summary.partial;
    const absent = catalog.summary.absent;
    expect(present + partial + absent).toBe(catalog.summary.totalOfficialToolsets);

    // A fully-mapped core toolset is present and exact.
    const file = catalog.toolsets.find((t) => t.id === 'file');
    expect(file).toBeDefined();
    expect(file?.readiness).toBe('present');
    expect(file?.presentToolCount).toBe(file?.expectedToolCount);
    expect(file?.missingToolNames).toEqual([]);

    // The reinforcement-learning toolset has no Code Buddy member surface: absent.
    const rl = catalog.toolsets.find((t) => t.id === 'rl');
    expect(rl).toBeDefined();
    expect(rl?.readiness).toBe('absent');
    expect(rl?.expectedToolCount).toBe(0);

    // Composite presets aggregate their constituent toolsets.
    const cli = catalog.toolsets.find((t) => t.id === 'hermes-cli');
    expect(cli?.group).toBe('composite');
    expect(cli?.composedOf.length).toBeGreaterThan(0);
    expect(cli?.expectedToolCount).toBeGreaterThan(0);
  });

  it('reports partial readiness when a member tool is unavailable', () => {
    // `write_file` is classified by direct name match in the parity manifest
    // (no equivalentCodeBuddyTools), so dropping it turns that member into a
    // gap and degrades the `file` toolset from present to partial.
    const reduced = collectOfflineBuiltinToolNames().filter((name) => name !== 'write_file');
    const catalog = buildHermesToolsetCatalog(reduced, GENERATED_AT);

    const file = catalog.toolsets.find((t) => t.id === 'file');
    expect(file).toBeDefined();
    expect(file?.readiness).toBe('partial');
    expect(file?.expectedToolCount).toBe(4);
    expect(file?.presentToolCount).toBe(3);
    expect(file?.missingToolNames).toContain('write_file');
  });

  it('only references official tool names that exist in the parity manifest', () => {
    const manifest = buildHermesToolParityManifest([], GENERATED_AT);
    const officialNames = new Set(manifest.tools.map((tool) => tool.name));

    for (const memberName of listCatalogMemberToolNames()) {
      expect(officialNames.has(memberName)).toBe(true);
    }
  });

  it('does not report unknown members (catalog stays consistent with the manifest)', () => {
    const catalog = buildLocalCatalog();
    for (const toolset of catalog.toolsets) {
      for (const member of toolset.members) {
        expect(member.status).not.toBe('unknown');
      }
    }
  });
});
