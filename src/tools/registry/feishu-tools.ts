import type { CodeBuddyTool } from '../../codebuddy/tool-definitions/types.js';
import {
  FEISHU_DOC_READ_TOOL,
  FEISHU_DRIVE_ADD_COMMENT_TOOL,
  FEISHU_DRIVE_LIST_COMMENT_REPLIES_TOOL,
  FEISHU_DRIVE_LIST_COMMENTS_TOOL,
  FEISHU_DRIVE_REPLY_COMMENT_TOOL,
} from '../../codebuddy/tool-definitions/feishu-tools.js';
import {
  executeFeishuTool,
  type FeishuToolName,
  type FeishuToolOptions,
} from '../feishu-tool.js';
import type { ToolResult } from '../../types/index.js';
import type {
  ITool,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
  ToolSchema,
} from './types.js';

const TOOL_DEFINITIONS: Record<FeishuToolName, CodeBuddyTool> = {
  feishu_doc_read: FEISHU_DOC_READ_TOOL,
  feishu_drive_list_comments: FEISHU_DRIVE_LIST_COMMENTS_TOOL,
  feishu_drive_list_comment_replies: FEISHU_DRIVE_LIST_COMMENT_REPLIES_TOOL,
  feishu_drive_reply_comment: FEISHU_DRIVE_REPLY_COMMENT_TOOL,
  feishu_drive_add_comment: FEISHU_DRIVE_ADD_COMMENT_TOOL,
};

export class FeishuTool implements ITool {
  readonly name: FeishuToolName;
  readonly description: string;

  constructor(
    name: FeishuToolName,
    private readonly options: FeishuToolOptions = {},
  ) {
    this.name = name;
    this.description = TOOL_DEFINITIONS[name].function.description;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return executeFeishuTool(this.name, input, this.options);
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
    if (this.name === 'feishu_doc_read' && !requiredText(data.doc_token)) {
      errors.push('doc_token is required');
    }
    if (this.name.startsWith('feishu_drive_') && !requiredText(data.file_token)) {
      errors.push('file_token is required');
    }
    if (
      (this.name === 'feishu_drive_list_comment_replies' || this.name === 'feishu_drive_reply_comment')
      && !requiredText(data.comment_id)
    ) {
      errors.push('comment_id is required');
    }
    if (
      (this.name === 'feishu_drive_reply_comment' || this.name === 'feishu_drive_add_comment')
      && !requiredText(data.content)
    ) {
      errors.push('content is required');
    }
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  }

  getMetadata(): IToolMetadata {
    const dangerous = this.name === 'feishu_drive_reply_comment' || this.name === 'feishu_drive_add_comment';
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['feishu', 'lark', 'document', 'drive', 'comment', 'docx', 'hermes'],
      priority: 8,
      modifiesFiles: false,
      makesNetworkRequests: true,
      requiresConfirmation: dangerous,
      fleetSafe: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createFeishuTools(options: FeishuToolOptions = {}): ITool[] {
  return [
    new FeishuTool('feishu_doc_read', options),
    new FeishuTool('feishu_drive_list_comments', options),
    new FeishuTool('feishu_drive_list_comment_replies', options),
    new FeishuTool('feishu_drive_reply_comment', options),
    new FeishuTool('feishu_drive_add_comment', options),
  ];
}

function requiredText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
