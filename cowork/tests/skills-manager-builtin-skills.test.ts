import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let testRoot = '';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => testRoot,
    getVersion: () => '0.0.0-test',
    getPath: (name: string) => {
      if (name === 'userData') return path.join(testRoot, 'userData');
      if (name === 'home') return path.join(testRoot, 'home');
      return testRoot;
    },
  },
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { SkillsManager } from '../src/main/skills/skills-manager';
import type { DatabaseInstance } from '../src/main/db/database';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests/ -> cowork/ -> .claude/skills (the bundled built-in skills directory).
const BUILTIN_SKILLS_DIR = path.join(__dirname, '..', '.claude', 'skills');

// The document/automation skills advertised in the README + demo videos.
const EXPECTED_BUILTIN_SKILLS = [
  'pptx',
  'docx',
  'xlsx',
  'pdf',
  'skill-creator',
  'workspace-organizer',
];

function createDbMock(): DatabaseInstance {
  const statement = { run: vi.fn() };
  return {
    raw: {} as any,
    sessions: {} as any,
    messages: {} as any,
    traceSteps: {} as any,
    scheduledTasks: {} as any,
    prepare: vi.fn(() => statement as any),
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn(),
  };
}

describe('Built-in Agent Skills are shipped and loadable', () => {
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-builtin-skills-test-'));
    fs.mkdirSync(path.join(testRoot, 'userData'), { recursive: true });
    fs.mkdirSync(path.join(testRoot, 'home'), { recursive: true });
  });

  afterEach(() => {
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('ships a SKILL.md for every advertised built-in skill', () => {
    expect(fs.existsSync(BUILTIN_SKILLS_DIR)).toBe(true);
    for (const name of EXPECTED_BUILTIN_SKILLS) {
      const skillMd = path.join(BUILTIN_SKILLS_DIR, name, 'SKILL.md');
      expect(fs.existsSync(skillMd), `missing SKILL.md for built-in skill: ${name}`).toBe(true);
    }
  });

  it('parses valid frontmatter (name + description) for every built-in skill', () => {
    const manager = new SkillsManager(createDbMock());
    for (const name of EXPECTED_BUILTIN_SKILLS) {
      const skillPath = path.join(BUILTIN_SKILLS_DIR, name);
      const metadata = manager.getSkillMetadata(skillPath);
      expect(metadata, `unparseable SKILL.md for built-in skill: ${name}`).not.toBeNull();
      expect(metadata?.name).toBe(name);
      expect(metadata?.description.length).toBeGreaterThan(0);
    }
  });

  it('loads the advertised built-in skills into the manager at construction', () => {
    const manager = new SkillsManager(createDbMock());
    const builtinSkills = manager.getAllSkills().filter((skill) => skill.type === 'builtin');
    const builtinNames = builtinSkills.map((skill) => skill.name).sort();
    expect(builtinNames).toEqual([...EXPECTED_BUILTIN_SKILLS].sort());
    for (const skill of builtinSkills) {
      expect(skill.id).toBe(`builtin-${skill.name}`);
      expect(skill.enabled).toBe(true);
    }
  });

  it('bundles the executable scripts the demo-video skills depend on', () => {
    // pptx / xlsx are the skills demonstrated generating real artifacts in the
    // README demo videos — guard that their helper scripts are actually shipped,
    // not just the SKILL.md prose.
    expect(fs.existsSync(path.join(BUILTIN_SKILLS_DIR, 'pptx', 'scripts', 'inventory.py'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(BUILTIN_SKILLS_DIR, 'xlsx', 'recalc.py'))).toBe(true);
    expect(
      fs.existsSync(path.join(BUILTIN_SKILLS_DIR, 'pdf', 'scripts', 'fill_fillable_fields.py'))
    ).toBe(true);
  });

  it('ships the workspace organization guardrails shown in the cleanup demo', () => {
    const skillMd = fs.readFileSync(
      path.join(BUILTIN_SKILLS_DIR, 'workspace-organizer', 'SKILL.md'),
      'utf8'
    );

    expect(skillMd).toContain('Do not delete files by default');
    expect(skillMd).toContain('organization-manifest.md');
    expect(skillMd).toContain('.git');
    expect(skillMd).toContain('content hash');
  });
});
