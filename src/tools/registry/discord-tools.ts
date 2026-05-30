import type { ToolResult } from '../../types/index.js';
import { DISCORD_ADMIN_TOOL, DISCORD_TOOL } from '../../codebuddy/tool-definitions/messaging-tools.js';
import {
  executeDiscordAdminTool,
  executeDiscordTool,
  type DiscordToolOptions,
} from '../discord-platform-tool.js';
import type {
  ITool,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
  ToolSchema,
} from './types.js';

export class DiscordTool implements ITool {
  readonly name = DISCORD_TOOL.function.name;
  readonly description = DISCORD_TOOL.function.description;

  constructor(private readonly options: DiscordToolOptions = {}) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await executeDiscordTool(input, this.options);
      return {
        success: result.ok,
        output: JSON.stringify(result, null, 2),
        data: result,
        ...(result.error ? { error: result.error } : {}),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: DISCORD_TOOL.function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const action = (input as Record<string, unknown>).action;
    if (action !== 'fetch_messages' && action !== 'search_members' && action !== 'create_thread') {
      return { valid: false, errors: ['action must be one of: fetch_messages, search_members, create_thread'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['discord', 'server', 'guild', 'messages', 'members', 'thread', 'hermes'],
      priority: 8,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export class DiscordAdminTool implements ITool {
  readonly name = DISCORD_ADMIN_TOOL.function.name;
  readonly description = DISCORD_ADMIN_TOOL.function.description;

  constructor(private readonly options: DiscordToolOptions = {}) {}

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await executeDiscordAdminTool(input, this.options);
      return {
        success: result.ok,
        output: JSON.stringify(result, null, 2),
        data: result,
        ...(result.error ? { error: result.error } : {}),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: DISCORD_ADMIN_TOOL.function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const action = (input as Record<string, unknown>).action;
    const actions = [
      'list_guilds',
      'server_info',
      'list_channels',
      'channel_info',
      'list_roles',
      'member_info',
      'list_pins',
      'pin_message',
      'unpin_message',
      'delete_message',
      'add_role',
      'remove_role',
    ];
    if (!actions.includes(String(action))) {
      return {
        valid: false,
        errors: ['action must be one of: list_guilds, server_info, list_channels, channel_info, list_roles, member_info, list_pins, pin_message, unpin_message, delete_message, add_role, remove_role'],
      };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['discord', 'admin', 'server', 'guild', 'roles', 'pins', 'moderation', 'hermes'],
      priority: 8,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createDiscordTools(options: DiscordToolOptions = {}): ITool[] {
  return [new DiscordTool(options), new DiscordAdminTool(options)];
}
