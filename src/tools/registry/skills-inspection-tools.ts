import {
  SKILLS_LIST_TOOL,
  SKILL_VIEW_TOOL,
} from '../../codebuddy/tool-definitions/agent-tools.js';
import type { ToolResult } from '../../types/index.js';
import {
  executeSkillsListTool,
  executeSkillViewTool,
} from '../skills-inspection-tool.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';

class CodeBuddyToolAdapter implements ITool {
  constructor(
    private readonly tool: typeof SKILLS_LIST_TOOL | typeof SKILL_VIEW_TOOL,
    private readonly executor: (input: Record<string, unknown>) => Promise<ToolResult>,
    private readonly keywords: string[],
  ) {}

  get name(): string {
    return this.tool.function.name;
  }

  get description(): string {
    return this.tool.function.description;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await this.executor(input);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: this.tool.function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    if (this.name === 'skill_view') {
      const name = (input as Record<string, unknown>).name;
      if (typeof name !== 'string' || name.trim().length === 0) {
        return { valid: false, errors: ['name is required'] };
      }
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: this.keywords,
      priority: this.name === 'skill_view' ? 6 : 5,
      modifiesFiles: false,
      makesNetworkRequests: false,
      fleetSafe: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createSkillsInspectionTools(): ITool[] {
  return [
    new CodeBuddyToolAdapter(
      SKILLS_LIST_TOOL,
      executeSkillsListTool,
      ['skills', 'skill', 'list', 'installed', 'enabled', 'disabled', 'hermes'],
    ),
    new CodeBuddyToolAdapter(
      SKILL_VIEW_TOOL,
      executeSkillViewTool,
      ['skills', 'skill', 'view', 'read', 'content', 'inspect', 'show', 'hermes'],
    ),
  ];
}
