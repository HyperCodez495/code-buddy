/**
 * AskUserQuestion Tool Adapter
 *
 * ITool-compliant adapter for the ask_user_question tool.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { executeAskUserQuestion, type AskUserQuestionInput } from '../ask-user-question-tool.js';

export class AskUserQuestionExecuteTool implements ITool {
  readonly name = 'ask_user_question';
  readonly description =
    'Ask the user 1–4 structured multi-option questions mid-task. Returns a JSON map of header→answer. Errors in non-TTY environments.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await executeAskUserQuestion(input as unknown as AskUserQuestionInput);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            description: '1–4 questions, each with header, question text, options, optional multiSelect',
          },
        },
        required: ['questions'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (!Array.isArray(data.questions)) {
      return { valid: false, errors: ['questions must be an array'] };
    }
    if (data.questions.length < 1 || data.questions.length > 4) {
      return { valid: false, errors: ['questions must contain 1–4 items'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['ask', 'question', 'user', 'clarify', 'choose', 'option', 'decide', 'multi-choice', 'prompt', 'interactive'],
      priority: 7,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createAskUserQuestionTools(): ITool[] {
  return [new AskUserQuestionExecuteTool()];
}

export function resetAskUserQuestionInstances(): void {
  // Stateless — nothing to reset
}
