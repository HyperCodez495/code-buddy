/**
 * Bundled weather skill — discovery + toolset augmentation contract.
 *
 * The skill is the DISCOVERY layer of the weather modernization: on a weather
 * question it must win the match (≥0.3, the applySkillMatching threshold) and
 * force-include the `weather` tool. Real SkillRegistry over the real bundled
 * dir — no mocks.
 */
import path from 'path';
import { describe, expect, it } from 'vitest';

import { SkillRegistry } from '../../src/skills/registry.js';
import { getBundledSkillsPath } from '../../src/skills/index.js';

async function bundledRegistry(): Promise<SkillRegistry> {
  const registry = new SkillRegistry({
    bundledPath: getBundledSkillsPath(),
    managedPath: path.join('/nonexistent', 'managed'),
    workspacePath: path.join('/nonexistent', 'workspace'),
    watchEnabled: false,
  });
  await registry.load();
  return registry;
}

describe('bundled weather skill', () => {
  it('wins the match for a French weather question at agent threshold (≥0.3)', async () => {
    const registry = await bundledRegistry();
    const match = registry.findBestMatch('quelle est la météo à Paris demain');
    expect(match?.skill.metadata.name).toBe('weather');
    expect(match?.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it('matches English weather phrasing too', async () => {
    const registry = await bundledRegistry();
    const match = registry.findBestMatch("what's the weather tomorrow in Berlin");
    expect(match?.skill.metadata.name).toBe('weather');
  });

  it('requires the weather tool (toolset augmentation contract)', async () => {
    const registry = await bundledRegistry();
    const skill = registry.get('weather');
    expect(skill).toBeDefined();
    expect(skill!.metadata.requires?.tools).toContain('weather');
  });

  it('outranks the web-search skill on a weather query', async () => {
    const registry = await bundledRegistry();
    const results = registry.search({ query: 'météo à Nantes' });
    const weatherIdx = results.findIndex((r) => r.skill.metadata.name === 'weather');
    const webIdx = results.findIndex((r) => r.skill.metadata.name === 'web-search');
    expect(weatherIdx).toBeGreaterThanOrEqual(0);
    if (webIdx >= 0) expect(weatherIdx).toBeLessThan(webIdx);
  });
});
