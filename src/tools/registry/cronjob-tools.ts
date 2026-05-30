import type { ToolResult } from '../../types/index.js';
import { CRONJOB_TOOL } from '../../codebuddy/tool-definitions/cron-tools.js';
import { executeCronjobTool } from '../cronjob-tool.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';

export class CronjobExecuteTool implements ITool {
  readonly name = CRONJOB_TOOL.function.name;
  readonly description = CRONJOB_TOOL.function.description;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await executeCronjobTool(input);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: CRONJOB_TOOL.function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const action = (input as Record<string, unknown>).action;
    if (typeof action !== 'string') {
      return { valid: false, errors: ['action is required'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'planning' as ToolCategoryType,
      keywords: [
        'cron',
        'cronjob',
        'schedule',
        'scheduled',
        'job',
        'jobs',
        'reminder',
        'monitor',
        'heartbeat',
        'watchdog',
        'hermes',
      ],
      priority: 8,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createCronjobTools(): ITool[] {
  return [new CronjobExecuteTool()];
}
