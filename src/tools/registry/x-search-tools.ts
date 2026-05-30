import type { CodeBuddyTool } from '../../codebuddy/tool-definitions/types.js';
import { X_SEARCH_TOOL } from '../../codebuddy/tool-definitions/x-search-tools.js';
import { executeXSearch, type XSearchOptions } from '../x-search-tool.js';
import type { ToolResult } from '../../types/index.js';
import type {
  ITool,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
  ToolSchema,
} from './types.js';

export class XSearchTool implements ITool {
  readonly name = 'x_search';
  readonly description = X_SEARCH_TOOL.function.description;

  constructor(private readonly options: XSearchOptions = {}) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return executeXSearch(input, this.options);
  }

  getSchema(): ToolSchema {
    const definition: CodeBuddyTool = X_SEARCH_TOOL;
    return {
      name: this.name,
      description: this.description,
      parameters: definition.function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.query !== 'string' || !data.query.trim()) {
      return { valid: false, errors: ['query is required'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['x', 'twitter', 'xai', 'grok', 'search', 'posts', 'citations', 'hermes'],
      priority: 8,
      modifiesFiles: false,
      makesNetworkRequests: true,
      fleetSafe: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createXSearchTools(options: XSearchOptions = {}): ITool[] {
  return [new XSearchTool(options)];
}
