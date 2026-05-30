import type { CodeBuddyTool } from './types.js';

const STATUS_ENUM = ['todo', 'in_progress', 'blocked', 'done'];
const PRIORITY_ENUM = ['low', 'medium', 'high', 'urgent'];

export const KANBAN_CREATE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'kanban_create',
    description: 'Create a persistent Hermes-compatible Kanban card in the current workspace',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Optional stable card id. A unique kb-* id is generated when omitted.',
        },
        title: {
          type: 'string',
          description: 'Short card title',
        },
        description: {
          type: 'string',
          description: 'Detailed task description or acceptance criteria',
        },
        status: {
          type: 'string',
          enum: STATUS_ENUM,
          description: 'Initial status, default todo',
        },
        priority: {
          type: 'string',
          enum: PRIORITY_ENUM,
          description: 'Priority, default medium',
        },
        assignee: {
          type: 'string',
          description: 'Human or agent responsible for the card',
        },
        tags: {
          type: 'array',
          description: 'Labels used to group cards',
          items: { type: 'string' },
        },
      },
      required: ['title'],
    },
  },
};

export const KANBAN_LIST_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'kanban_list',
    description: 'List persistent Kanban cards for the current workspace',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: STATUS_ENUM,
          description: 'Optional status filter',
        },
        priority: {
          type: 'string',
          enum: PRIORITY_ENUM,
          description: 'Optional priority filter',
        },
        assignee: {
          type: 'string',
          description: 'Optional assignee filter',
        },
        tag: {
          type: 'string',
          description: 'Optional tag filter',
        },
        include_done: {
          type: 'boolean',
          description: 'Whether completed cards should be included; defaults to true',
        },
      },
      required: [],
    },
  },
};

export const KANBAN_SHOW_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'kanban_show',
    description: 'Show one persistent Kanban card by id',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Kanban card id',
        },
      },
      required: ['id'],
    },
  },
};

export const KANBAN_COMPLETE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'kanban_complete',
    description: 'Mark a Kanban card as done and optionally add a completion comment',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Kanban card id',
        },
        comment: {
          type: 'string',
          description: 'Optional completion note',
        },
        author: {
          type: 'string',
          description: 'Human or agent adding the note',
        },
      },
      required: ['id'],
    },
  },
};

export const KANBAN_BLOCK_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'kanban_block',
    description: 'Mark a Kanban card as blocked with a required reason',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Kanban card id',
        },
        reason: {
          type: 'string',
          description: 'Blocking reason',
        },
        author: {
          type: 'string',
          description: 'Human or agent reporting the block',
        },
      },
      required: ['id', 'reason'],
    },
  },
};

export const KANBAN_UNBLOCK_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'kanban_unblock',
    description: 'Clear a Kanban card block and move it back to in_progress',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Kanban card id',
        },
        comment: {
          type: 'string',
          description: 'Optional unblock note',
        },
        author: {
          type: 'string',
          description: 'Human or agent clearing the block',
        },
      },
      required: ['id'],
    },
  },
};

export const KANBAN_COMMENT_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'kanban_comment',
    description: 'Append a comment to a Kanban card',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Kanban card id',
        },
        text: {
          type: 'string',
          description: 'Comment body',
        },
        author: {
          type: 'string',
          description: 'Human or agent adding the comment',
        },
      },
      required: ['id', 'text'],
    },
  },
};

export const KANBAN_HEARTBEAT_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'kanban_heartbeat',
    description: 'Record progress heartbeat on a Kanban card',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Kanban card id',
        },
        message: {
          type: 'string',
          description: 'Optional progress note',
        },
        author: {
          type: 'string',
          description: 'Human or agent reporting progress',
        },
      },
      required: ['id'],
    },
  },
};

export const KANBAN_LINK_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'kanban_link',
    description: 'Attach an artifact, URL, commit, issue, or related card reference to a Kanban card',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Kanban card id',
        },
        target: {
          type: 'string',
          description: 'URL, file path, commit id, issue id, or related card id',
        },
        label: {
          type: 'string',
          description: 'Optional human-readable label for the link',
        },
      },
      required: ['id', 'target'],
    },
  },
};

export const KANBAN_TOOLS: CodeBuddyTool[] = [
  KANBAN_SHOW_TOOL,
  KANBAN_LIST_TOOL,
  KANBAN_COMPLETE_TOOL,
  KANBAN_BLOCK_TOOL,
  KANBAN_HEARTBEAT_TOOL,
  KANBAN_COMMENT_TOOL,
  KANBAN_CREATE_TOOL,
  KANBAN_LINK_TOOL,
  KANBAN_UNBLOCK_TOOL,
];
