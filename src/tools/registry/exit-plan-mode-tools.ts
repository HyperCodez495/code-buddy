/**
 * ExitPlanMode Tool Adapter (V4.4)
 *
 * ITool-compliant adapter for the `exit_plan_mode` tool.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { executeExitPlanMode, type ExitPlanModeInput } from '../exit-plan-mode-tool.js';

export class ExitPlanModeExecuteTool implements ITool {
  readonly name = 'exit_plan_mode';
  readonly description =
    'Request user approval to leave plan mode and start executing. Errors outside plan mode and in non-TTY environments.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await executeExitPlanMode(input as unknown as ExitPlanModeInput);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          allowedPrompts: {
            type: 'array',
            description: 'Optional next-step hints (≤16) shown to the user',
          },
          planSummary: {
            type: 'string',
            description: 'Optional inline plan when no markdown file is registered',
          },
        },
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (input != null && typeof input !== 'object') {
      return { valid: false, errors: ['Input must be an object or omitted'] };
    }
    const data = (input ?? {}) as Record<string, unknown>;
    if (data.allowedPrompts !== undefined && !Array.isArray(data.allowedPrompts)) {
      return { valid: false, errors: ['allowedPrompts must be an array'] };
    }
    if (data.planSummary !== undefined && typeof data.planSummary !== 'string') {
      return { valid: false, errors: ['planSummary must be a string'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['plan', 'exit', 'approve', 'approval', 'leave', 'unlock', 'execute', 'proceed'],
      priority: 7,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createExitPlanModeTools(): ITool[] {
  return [new ExitPlanModeExecuteTool()];
}

export function resetExitPlanModeInstances(): void {
  // Stateless — nothing to reset
}
