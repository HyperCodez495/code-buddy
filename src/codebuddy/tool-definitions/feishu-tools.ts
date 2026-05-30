import type { CodeBuddyTool } from './types.js';

export const FEISHU_DOC_READ_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'feishu_doc_read',
    description:
      'Read the full plain-text content of a Feishu/Lark document by document token.',
    parameters: {
      type: 'object',
      properties: {
        doc_token: {
          type: 'string',
          description: 'Document token from the Feishu/Lark document URL or comment context.',
        },
      },
      required: ['doc_token'],
    },
  },
};

export const FEISHU_DRIVE_LIST_COMMENTS_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'feishu_drive_list_comments',
    description:
      'List comments on a Feishu/Lark drive file, optionally limited to whole-document comments.',
    parameters: {
      type: 'object',
      properties: {
        file_token: {
          type: 'string',
          description: 'Drive file token for the document or file.',
        },
        file_type: {
          type: 'string',
          description: 'Drive file type, default docx.',
          default: 'docx',
        },
        is_whole: {
          type: 'boolean',
          description: 'If true, list whole-document comments only.',
          default: false,
        },
        page_size: {
          type: 'number',
          description: 'Number of comments to return, max 100.',
          default: 100,
        },
        page_token: {
          type: 'string',
          description: 'Pagination token for the next page.',
        },
      },
      required: ['file_token'],
    },
  },
};

export const FEISHU_DRIVE_LIST_COMMENT_REPLIES_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'feishu_drive_list_comment_replies',
    description: 'List replies in a Feishu/Lark drive comment thread.',
    parameters: {
      type: 'object',
      properties: {
        file_token: {
          type: 'string',
          description: 'Drive file token for the document or file.',
        },
        comment_id: {
          type: 'string',
          description: 'Comment thread ID.',
        },
        file_type: {
          type: 'string',
          description: 'Drive file type, default docx.',
          default: 'docx',
        },
        page_size: {
          type: 'number',
          description: 'Number of replies to return, max 100.',
          default: 100,
        },
        page_token: {
          type: 'string',
          description: 'Pagination token for the next page.',
        },
      },
      required: ['file_token', 'comment_id'],
    },
  },
};

export const FEISHU_DRIVE_REPLY_COMMENT_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'feishu_drive_reply_comment',
    description:
      'Reply with plain text to an existing Feishu/Lark drive comment thread.',
    parameters: {
      type: 'object',
      properties: {
        file_token: {
          type: 'string',
          description: 'Drive file token for the document or file.',
        },
        comment_id: {
          type: 'string',
          description: 'Comment thread ID to reply to.',
        },
        content: {
          type: 'string',
          description: 'Plain-text reply content.',
        },
        file_type: {
          type: 'string',
          description: 'Drive file type, default docx.',
          default: 'docx',
        },
      },
      required: ['file_token', 'comment_id', 'content'],
    },
  },
};

export const FEISHU_DRIVE_ADD_COMMENT_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'feishu_drive_add_comment',
    description:
      'Add a new whole-document plain-text comment to a Feishu/Lark drive file.',
    parameters: {
      type: 'object',
      properties: {
        file_token: {
          type: 'string',
          description: 'Drive file token for the document or file.',
        },
        content: {
          type: 'string',
          description: 'Plain-text comment content.',
        },
        file_type: {
          type: 'string',
          description: 'Drive file type, default docx.',
          default: 'docx',
        },
      },
      required: ['file_token', 'content'],
    },
  },
};

export const FEISHU_TOOLS: CodeBuddyTool[] = [
  FEISHU_DOC_READ_TOOL,
  FEISHU_DRIVE_LIST_COMMENTS_TOOL,
  FEISHU_DRIVE_LIST_COMMENT_REPLIES_TOOL,
  FEISHU_DRIVE_REPLY_COMMENT_TOOL,
  FEISHU_DRIVE_ADD_COMMENT_TOOL,
];
