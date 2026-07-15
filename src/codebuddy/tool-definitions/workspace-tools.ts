import type { CodeBuddyTool } from './types.js';

export const WORKSPACE_SEARCH_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'workspace_search',
    description:
      'Search literal text across repositories in the opt-in multi-repo workspace. Results are prefixed repo:path:line and globally bounded.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Literal text to search for.' },
        repos: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional repository names to search.',
        },
        max_results: {
          type: 'number',
          description: 'Maximum aggregated matches (default 50, hard limit 200).',
        },
        glob: { type: 'string', description: 'Optional include glob such as **/*.ts.' },
      },
      required: ['query'],
    },
  },
};

export const WORKSPACE_READ_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'workspace_read',
    description:
      'Read a size-bounded file from a named repository in the opt-in multi-repo workspace. Paths must remain inside the repository realpath.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Workspace repository name.' },
        path: { type: 'string', description: 'Repository-relative file path.' },
        offset: { type: 'number', description: 'Zero-based first line offset.' },
        limit: { type: 'number', description: 'Maximum number of lines to return.' },
      },
      required: ['repo', 'path'],
    },
  },
};

export const WORKSPACE_TOOLS: CodeBuddyTool[] = [WORKSPACE_SEARCH_TOOL, WORKSPACE_READ_TOOL];
