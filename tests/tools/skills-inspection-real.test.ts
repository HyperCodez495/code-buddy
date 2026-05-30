import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let tempHome: string;

async function parseToolOutput(result: { success: boolean; output?: string; error?: string }) {
  expect(result.success, result.error).toBe(true);
  expect(result.output).toBeTruthy();
  return JSON.parse(result.output as string) as Record<string, unknown>;
}

describe('skills_list and skill_view real SkillsHub integration', () => {
  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-skills-tools-'));
  });

  afterEach(async () => {
    const { resetSkillsHub } = await import('../../src/skills/hub.js');
    resetSkillsHub();
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it('lists and reads installed SKILL.md packages from the real lockfile', async () => {
    const { getSkillsHub, resetSkillsHub } = await import('../../src/skills/hub.js');
    resetSkillsHub();
    const hub = getSkillsHub({
      cacheDir: path.join(tempHome, 'cache'),
      skillsDir: path.join(tempHome, 'skills'),
      lockfilePath: path.join(tempHome, 'lock.json'),
    });

    await hub.installFromContent(
      'audit-helper',
      [
        '---',
        'name: audit-helper',
        'version: 1.2.3',
        'description: Real audit helper skill',
        '---',
        '',
        '# Audit Helper',
        '',
        'Run concrete checks and report evidence.',
      ].join('\n'),
    );
    hub.setEnabled('disabled-helper', false, {
      path: path.join(tempHome, 'disabled-helper', 'SKILL.md'),
      version: '0.1.0',
    });

    const { createSkillsInspectionTools } = await import('../../src/tools/registry/skills-inspection-tools.js');
    const [listTool, viewTool] = createSkillsInspectionTools();

    const enabledOnly = await parseToolOutput(await listTool!.execute({}));
    expect(enabledOnly.count).toBe(1);
    expect((enabledOnly.skills as Array<{ name: string }>).map((skill) => skill.name)).toEqual(['audit-helper']);

    const allSkills = await parseToolOutput(await listTool!.execute({ include_disabled: true }));
    expect(allSkills.count).toBe(2);

    const viewed = await parseToolOutput(await viewTool!.execute({ name: 'audit-helper' }));
    expect((viewed.installed as { version: string }).version).toBe('1.2.3');
    expect(viewed.integrityOk).toBe(true);
    expect(viewed.content).toContain('# Audit Helper');
  });
});
