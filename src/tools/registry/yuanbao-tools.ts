import type { CodeBuddyTool } from '../../codebuddy/tool-definitions/types.js';
import {
  YB_QUERY_GROUP_INFO_TOOL,
  YB_QUERY_GROUP_MEMBERS_TOOL,
  YB_SEARCH_STICKER_TOOL,
  YB_SEND_DM_TOOL,
  YB_SEND_STICKER_TOOL,
} from '../../codebuddy/tool-definitions/yuanbao-tools.js';
import type { ToolResult } from '../../types/index.js';
import {
  executeYuanbaoTool,
  type YuanbaoToolName,
  type YuanbaoToolOptions,
} from '../yuanbao-tool.js';
import type {
  ITool,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
  ToolSchema,
} from './types.js';

const TOOL_DEFINITIONS: Record<YuanbaoToolName, CodeBuddyTool> = {
  yb_query_group_info: YB_QUERY_GROUP_INFO_TOOL,
  yb_query_group_members: YB_QUERY_GROUP_MEMBERS_TOOL,
  yb_send_dm: YB_SEND_DM_TOOL,
  yb_search_sticker: YB_SEARCH_STICKER_TOOL,
  yb_send_sticker: YB_SEND_STICKER_TOOL,
};

export class YuanbaoTool implements ITool {
  readonly name: YuanbaoToolName;
  readonly description: string;

  constructor(
    name: YuanbaoToolName,
    private readonly options: YuanbaoToolOptions = {},
  ) {
    this.name = name;
    this.description = TOOL_DEFINITIONS[name].function.description;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return executeYuanbaoTool(this.name, input, this.options);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: TOOL_DEFINITIONS[this.name].function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    const errors: string[] = [];
    if (this.name === 'yb_query_group_info' && !requiredText(data.group_code)) {
      errors.push('group_code is required');
    }
    if (this.name === 'yb_query_group_members') {
      if (!requiredText(data.group_code)) {
        errors.push('group_code is required');
      }
      if (!requiredText(data.action)) {
        errors.push('action is required');
      } else if (!['find', 'list_bots', 'list_all'].includes(String(data.action))) {
        errors.push('action must be one of: find, list_bots, list_all');
      }
    }
    if (this.name === 'yb_send_dm') {
      const hasMessage = requiredText(data.message);
      const hasMedia = Array.isArray(data.media_files) && data.media_files.length > 0;
      if (!hasMessage && !hasMedia) {
        errors.push('message or media_files is required');
      }
      if (!requiredText(data.user_id) && !requiredText(data.group_code)) {
        errors.push('group_code is required when user_id is not provided');
      }
      if (!requiredText(data.user_id) && !requiredText(data.name)) {
        errors.push('name is required when user_id is not provided');
      }
    }
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  }

  getMetadata(): IToolMetadata {
    const mutating = this.name === 'yb_send_dm' || this.name === 'yb_send_sticker';
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['yuanbao', 'hermes', 'group', 'members', 'dm', 'sticker', 'pai'],
      priority: 8,
      modifiesFiles: false,
      makesNetworkRequests: this.name !== 'yb_search_sticker',
      requiresConfirmation: mutating,
      fleetSafe: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createYuanbaoTools(options: YuanbaoToolOptions = {}): ITool[] {
  return [
    new YuanbaoTool('yb_query_group_info', options),
    new YuanbaoTool('yb_query_group_members', options),
    new YuanbaoTool('yb_send_dm', options),
    new YuanbaoTool('yb_search_sticker', options),
    new YuanbaoTool('yb_send_sticker', options),
  ];
}

function requiredText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
