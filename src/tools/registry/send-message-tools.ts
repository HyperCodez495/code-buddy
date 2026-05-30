import type { ToolResult } from '../../types/index.js';
import { SEND_MESSAGE_TOOL } from '../../codebuddy/tool-definitions/messaging-tools.js';
import {
  executeSendMessage,
  type SendMessageExecutorOptions,
  type SendMessageInput,
  type SendMessageParseMode,
} from '../../channels/send-message.js';
import type { ChannelType, ContentType } from '../../channels/core.js';
import type {
  ITool,
  IToolExecutionContext,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
  ToolSchema,
} from './types.js';

export class SendMessageTool implements ITool {
  readonly name = SEND_MESSAGE_TOOL.function.name;
  readonly description = SEND_MESSAGE_TOOL.function.description;

  constructor(private readonly options: SendMessageExecutorOptions = {}) {}

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const result = await executeSendMessage(parseInput(input), {
        ...this.options,
        rootDir: this.options.rootDir ?? context?.cwd,
      });
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
      parameters: SEND_MESSAGE_TOOL.function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    const errors: string[] = [];
    if (typeof data.channel !== 'string') errors.push('channel is required');
    if (typeof data.channel_id !== 'string') errors.push('channel_id is required');
    if (typeof data.content !== 'string') errors.push('content is required');
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['send', 'message', 'channel', 'telegram', 'discord', 'slack', 'email', 'hermes'],
      priority: 8,
      modifiesFiles: true,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createSendMessageTools(options: SendMessageExecutorOptions = {}): ITool[] {
  return [new SendMessageTool(options)];
}

function parseInput(input: Record<string, unknown>): SendMessageInput {
  return {
    channel: requiredString(input, 'channel') as ChannelType,
    channelId: requiredString(input, 'channel_id'),
    content: requiredString(input, 'content'),
    ...(optionalString(input, 'content_type') ? { contentType: optionalString(input, 'content_type') as ContentType } : {}),
    ...(typeof input.dry_run === 'boolean' ? { dryRun: input.dry_run } : {}),
    ...(optionalString(input, 'approved_by') ? { approvedBy: optionalString(input, 'approved_by') } : {}),
    ...(optionalString(input, 'parse_mode') ? { parseMode: optionalString(input, 'parse_mode') as SendMessageParseMode } : {}),
    ...(optionalString(input, 'thread_id') ? { threadId: optionalString(input, 'thread_id') } : {}),
    ...(optionalString(input, 'reply_to') ? { replyTo: optionalString(input, 'reply_to') } : {}),
    ...(typeof input.disable_preview === 'boolean' ? { disablePreview: input.disable_preview } : {}),
    ...(typeof input.silent === 'boolean' ? { silent: input.silent } : {}),
    ...(optionalString(input, 'peer_id') ? { peerId: optionalString(input, 'peer_id') } : {}),
    ...(optionalString(input, 'chat_type') ? { chatType: optionalString(input, 'chat_type') as SendMessageInput['chatType'] } : {}),
  };
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = optionalString(input, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
