import { getErrorMessage, type ToolResult } from '../types/index.js';
import type { InstalledSkill } from '../skills/hub.js';

export interface SkillsListToolInput extends Record<string, unknown> {
  include_disabled?: unknown;
  include_usage?: unknown;
}

export interface SkillViewToolInput extends Record<string, unknown> {
  name?: unknown;
  include_content?: unknown;
}

function serializePayload(payload: Record<string, unknown>): ToolResult {
  return {
    success: true,
    output: JSON.stringify(payload, null, 2),
    data: payload,
  };
}

function stripUsage(skill: InstalledSkill): InstalledSkill {
  const { usage: _usage, ...rest } = skill;
  return rest;
}

export async function executeSkillsListTool(input: SkillsListToolInput): Promise<ToolResult> {
  try {
    const { getSkillsHub } = await import('../skills/hub.js');
    const hub = getSkillsHub();
    const all = hub.list();
    const includeDisabled = input.include_disabled === true;
    const includeUsage = input.include_usage !== false;
    const shown = includeDisabled ? all : all.filter((skill) => skill.enabled !== false);
    const skills = includeUsage ? shown : shown.map(stripUsage);

    return serializePayload({
      action: 'skills_list',
      count: skills.length,
      total: all.length,
      includeDisabled,
      skills,
    });
  } catch (error) {
    return { success: false, error: `skills_list: ${getErrorMessage(error)}` };
  }
}

export async function executeSkillViewTool(input: SkillViewToolInput): Promise<ToolResult> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) {
    return { success: false, error: 'skill_view: name is required' };
  }

  try {
    const { getSkillsHub } = await import('../skills/hub.js');
    const result = getSkillsHub().info(name);
    if (!result) {
      return { success: false, error: `skill_view: skill not found: ${name}` };
    }

    const includeContent = input.include_content !== false;
    return serializePayload({
      action: 'skill_view',
      installed: result.installed,
      integrityOk: result.integrityOk,
      ...(includeContent ? { content: result.content ?? '' } : {}),
    });
  } catch (error) {
    return { success: false, error: `skill_view: ${getErrorMessage(error)}` };
  }
}
