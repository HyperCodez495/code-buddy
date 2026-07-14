import type { CodeBuddyTool } from './types.js';

/** Read-only operational self-model backed by source and live runtime evidence. */
export const SELF_DESCRIBE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'self_describe',
    description:
      "Inspect this robot/agent's implementation and evidenced turn metadata: package/revision, relevant code areas, model/provider/surface, registered versus currently exposed tools, configuration-only faculties, and explicit limits. It performs no live hardware, process, service, or network probes; unavailable attestations remain unknown. " +
      'Use it for technical introspection and questions about current capabilities. Its output is a verifiable operational self-model, never evidence of subjective consciousness.',
    parameters: {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          maxLength: 320,
          description: 'The aspect of this agent to inspect, for example voice, memory, routing, architecture, or a current limitation.',
        },
        depth: {
          type: 'string',
          enum: ['summary', 'deep'],
          description: 'summary returns a compact snapshot; deep inspects more curated source areas.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

export const SELF_DESCRIBE_TOOLS: CodeBuddyTool[] = [SELF_DESCRIBE_TOOL];
