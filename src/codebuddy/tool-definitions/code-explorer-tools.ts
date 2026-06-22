/**
 * CodeExplorer Tool Definitions
 *
 * OpenAI function calling schema for the CodeExplorer tool.
 */

import type { CodeBuddyTool } from './types.js';

export const CODE_EXPLORER_ASK_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'code_explorer_ask',
    description:
      'Consult CodeExplorer for a query or code understanding request. Returns related files, dependent symbols, tests to watch, and technical recommendations. This is a read-only tool.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The query or task description to ask CodeExplorer about.',
        },
      },
      required: ['query'],
    },
  },
};

export const CODE_EXPLORER_TOOLS: CodeBuddyTool[] = [CODE_EXPLORER_ASK_TOOL];
