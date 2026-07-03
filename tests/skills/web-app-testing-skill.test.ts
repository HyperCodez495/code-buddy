/**
 * Bundled web-app-testing skill — the discovery layer of the
 * develop → launch → browse → verify loop: a "test the app" ask must
 * surface the skill and force-include the app_server + web_test tools.
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

describe('bundled web-app-testing skill', () => {
  it('matches French and English "test the app" phrasings at agent threshold', async () => {
    const registry = await bundledRegistry();
    for (const query of [
      "lance le dev server et teste l'application",
      'build the page then test the app in the browser',
    ]) {
      const match = registry.findBestMatch(query);
      expect(match?.skill.metadata.name, query).toBe('web-app-testing');
      expect(match?.confidence, query).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('force-includes the loop tools (app_server, web_test, browser)', async () => {
    const registry = await bundledRegistry();
    const skill = registry.get('web-app-testing');
    expect(skill).toBeDefined();
    const tools = skill!.metadata.requires?.tools ?? [];
    expect(tools).toContain('app_server');
    expect(tools).toContain('web_test');
    expect(tools).toContain('browser');
  });
});
