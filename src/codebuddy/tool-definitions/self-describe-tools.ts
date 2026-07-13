import type { CodeBuddyTool } from './types.js';

/** Read-only operational self-model backed by the live formal tool registry. */
export const SELF_DESCRIBE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'self_describe',
    description:
      "Describe this robot/agent's installed components, package version, configured faculties, limits, and available code self-inspection tools. " +
      'Use it for technical introspection and questions about current capabilities. Its output is a verifiable operational self-model, never evidence of subjective consciousness.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const SELF_DESCRIBE_TOOLS: CodeBuddyTool[] = [SELF_DESCRIBE_TOOL];
