import type { CodeBuddyTool } from './types.js';

export const YB_QUERY_GROUP_INFO_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'yb_query_group_info',
    description:
      "Query basic Yuanbao group info, including group name, owner, and member count.",
    parameters: {
      type: 'object',
      properties: {
        group_code: {
          type: 'string',
          description: 'Unique Yuanbao group identifier.',
        },
      },
      required: ['group_code'],
    },
  },
};

export const YB_QUERY_GROUP_MEMBERS_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'yb_query_group_members',
    description:
      'Query Yuanbao group members before mentioning, finding, listing bots, or listing all members.',
    parameters: {
      type: 'object',
      properties: {
        group_code: {
          type: 'string',
          description: 'Unique Yuanbao group identifier.',
        },
        action: {
          type: 'string',
          enum: ['find', 'list_bots', 'list_all'],
          description: 'find searches by nickname, list_bots lists bots/Yuanbao AI, list_all lists everyone.',
        },
        name: {
          type: 'string',
          description: 'Partial display name to search when action is find.',
        },
        mention: {
          type: 'boolean',
          description: 'If true, include exact mention-format guidance in the response.',
        },
      },
      required: ['group_code', 'action'],
    },
  },
};

export const YB_SEND_DM_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'yb_send_dm',
    description:
      'Send a private Yuanbao DM to a group member by user_id or by resolving a nickname through the member list.',
    parameters: {
      type: 'object',
      properties: {
        group_code: {
          type: 'string',
          description: 'Group where the target user belongs; required when user_id is not provided.',
        },
        name: {
          type: 'string',
          description: 'Target display name, partial match; required when user_id is not provided.',
        },
        message: {
          type: 'string',
          description: 'Text to send. Can be empty if media_files contains at least one file.',
        },
        user_id: {
          type: 'string',
          description: 'Target Yuanbao account ID; skips member lookup when provided.',
        },
        media_files: {
          type: 'array',
          description: 'Optional local media files to send after the text.',
          items: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Absolute local file path to send.',
              },
              is_voice: {
                type: 'boolean',
                description: 'Whether this media should be treated as a voice message.',
              },
            },
            required: ['path'],
          },
        },
        approved_by: {
          type: 'string',
          description: 'Required for external Yuanbao delivery; records who approved the send.',
        },
      },
      required: [],
    },
  },
};

export const YB_SEARCH_STICKER_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'yb_search_sticker',
    description:
      'Search the Yuanbao built-in sticker catalog by keyword before sending a sticker.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keyword. Empty string returns the first candidates.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum candidate count, default 10 and max 50.',
        },
      },
      required: [],
    },
  },
};

export const YB_SEND_STICKER_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'yb_send_sticker',
    description:
      'Send a built-in Yuanbao sticker to the current or specified Yuanbao chat.',
    parameters: {
      type: 'object',
      properties: {
        sticker: {
          type: 'string',
          description: 'Sticker name or numeric sticker_id. Empty lets the adapter choose a random sticker.',
        },
        chat_id: {
          type: 'string',
          description: "Target chat_id; defaults to CODEBUDDY_YUANBAO_HOME_CHAT_ID or HERMES_SESSION_CHAT_ID.",
        },
        reply_to: {
          type: 'string',
          description: 'Optional message id to quote-reply to.',
        },
        approved_by: {
          type: 'string',
          description: 'Required for external Yuanbao delivery; records who approved the send.',
        },
      },
      required: [],
    },
  },
};

export const YUANBAO_TOOLS: CodeBuddyTool[] = [
  YB_QUERY_GROUP_INFO_TOOL,
  YB_QUERY_GROUP_MEMBERS_TOOL,
  YB_SEND_DM_TOOL,
  YB_SEARCH_STICKER_TOOL,
  YB_SEND_STICKER_TOOL,
];
