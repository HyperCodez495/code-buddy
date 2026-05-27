import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSkillRegistry } from '../../src/skills/registry.js';
import { getSkillsHub } from '../../src/skills/hub.js';
import { getSkillManager } from '../../src/skills/skill-manager.js';
import { getSkillAugmentedTools } from '../../src/codebuddy/tools.js';
import { ToolSelectionStrategy } from '../../src/agent/execution/tool-selection-strategy.js';
import type { UnifiedSkill } from '../../src/skills/types.js';

vi.mock('../../src/skills/hub.js', async (importOriginal) => {
  const original = await importOriginal();
  const mockHub = {
    list: vi.fn().mockReturnValue([]),
  };
  return {
    ...original,
    getSkillsHub: () => mockHub,
  };
});

describe('Skills Exclusion and Isolation Context', () => {
  let registry: any;
  let manager: any;
  let mockHub: any;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = getSkillRegistry();
    manager = getSkillManager();
    mockHub = getSkillsHub();
  });

  it('marks skill as disabled in getAllUnified when it is disabled in the hub', () => {
    // Register a dummy skill
    const skillName = 'test-dummy-skill';
    registry.skills.set(skillName, {
      metadata: { name: skillName, description: 'Dummy description' },
      content: { description: 'Dummy system prompt', rawMarkdown: 'Dummy raw' },
      enabled: true,
      tier: 'workspace',
    });

    // Mock hub disabling this skill
    mockHub.list.mockReturnValue([
      { name: skillName, enabled: false }
    ]);

    const unifiedSkills = registry.getAllUnified();
    const targetSkill = unifiedSkills.find((s: UnifiedSkill) => s.name === skillName);

    expect(targetSkill).toBeDefined();
    expect(targetSkill?.enabled).toBe(false);

    // Cleanup
    registry.skills.delete(skillName);
  });

  it('excludes disabled skills from getSkillPromptEnhancement', () => {
    const skillName = 'test-prompt-dummy';
    const dummySkill = {
      name: skillName,
      description: 'Dummy',
      triggers: ['dummy-trigger'],
      systemPrompt: 'Do not inject this!',
    };

    manager.skills.set(skillName, dummySkill);
    manager.activeSkill = dummySkill;

    // Mock hub disabling it
    mockHub.list.mockReturnValue([
      { name: skillName, enabled: false }
    ]);

    const promptBlock = manager.getSkillPromptEnhancement();
    expect(promptBlock).toBe('');

    // Cleanup
    manager.skills.delete(skillName);
    manager.activeSkill = null;
  });

  it('refuses to set a disabled active skill in ToolSelectionStrategy', () => {
    const skillName = 'disabled-selection-skill';
    const strategy = new ToolSelectionStrategy();
    const dummySkill: UnifiedSkill = {
      name: skillName,
      description: 'Dummy',
      source: 'skillmd',
      enabled: true,
      systemPrompt: 'Prompt',
    };

    // Mock hub disabling it
    mockHub.list.mockReturnValue([
      { name: skillName, enabled: false }
    ]);

    strategy.setActiveSkill(dummySkill);
    expect(strategy.getActiveSkill()).toBeNull();
  });

  it('does not augment tools if the skill is disabled', () => {
    const skillName = 'disabled-tools-skill';
    const dummySkill: UnifiedSkill = {
      name: skillName,
      description: 'Dummy',
      source: 'skillmd',
      enabled: true,
      tools: ['bash'],
      systemPrompt: 'Prompt',
    };

    // Mock hub disabling it
    mockHub.list.mockReturnValue([
      { name: skillName, enabled: false }
    ]);

    const originalTools: any[] = [];
    const augmented = getSkillAugmentedTools(originalTools, dummySkill);

    // Tools should not be augmented (i.e. remains empty)
    expect(augmented.length).toBe(0);
  });
});
