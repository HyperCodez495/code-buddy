import type { CodeBuddyTool } from './types.js';

const STRING = { type: 'string' };

export const X_SEARCH_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'x_search',
    description:
      "Search X posts, profiles, and threads using xAI's built-in X Search Responses API tool. Use this for current discussion, reactions, or claims on X rather than general web pages.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to look up on X.',
        },
        allowed_x_handles: {
          type: 'array',
          items: STRING,
          description: 'Optional list of X handles to include exclusively, max 10.',
        },
        excluded_x_handles: {
          type: 'array',
          items: STRING,
          description: 'Optional list of X handles to exclude, max 10.',
        },
        from_date: {
          type: 'string',
          description: 'Optional start date in YYYY-MM-DD format.',
        },
        to_date: {
          type: 'string',
          description: 'Optional end date in YYYY-MM-DD format.',
        },
        enable_image_understanding: {
          type: 'boolean',
          description: 'Whether xAI should analyze images attached to matching X posts.',
          default: false,
        },
        enable_video_understanding: {
          type: 'boolean',
          description: 'Whether xAI should analyze videos attached to matching X posts.',
          default: false,
        },
      },
      required: ['query'],
    },
  },
};

export const X_SEARCH_TOOLS: CodeBuddyTool[] = [X_SEARCH_TOOL];
