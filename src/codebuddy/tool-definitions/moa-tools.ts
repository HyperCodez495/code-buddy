import type { CodeBuddyTool } from './types.js';

export const MIXTURE_OF_AGENTS_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'mixture_of_agents',
    description:
      'Route a genuinely hard problem through multiple frontier LLM references and an aggregator. ' +
      'Uses configured OpenRouter-compatible credentials and should be used sparingly for complex math, algorithms, architecture, or analytical reasoning.',
    parameters: {
      type: 'object',
      properties: {
        user_prompt: {
          type: 'string',
          description:
            'The complex query or problem to solve using multiple model perspectives and a final aggregator.',
        },
      },
      required: ['user_prompt'],
    },
  },
};

export const MOA_TOOLS: CodeBuddyTool[] = [MIXTURE_OF_AGENTS_TOOL];
