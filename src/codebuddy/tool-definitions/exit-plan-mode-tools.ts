/**
 * ExitPlanMode Tool Definitions
 *
 * OpenAI function-calling schema for `exit_plan_mode` (V4.4).
 * Lets the LLM request user approval to leave plan mode and start
 * executing the plan it just produced.
 */

import type { CodeBuddyTool } from './types.js';

export const EXIT_PLAN_MODE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'exit_plan_mode',
    description:
      'Signal that your plan-mode research is complete and request user approval to leave ' +
      'plan mode (DEFAULT mode) so you can start executing. Use ONLY when (a) you have ' +
      'already produced/updated a plan markdown file, OR (b) you provide a `planSummary` ' +
      'inline; AND the user has not yet approved it. The tool shows the plan to the user ' +
      'and prompts for approval — on approval the agent switches to DEFAULT mode and you ' +
      'may run write/execute tools; on rejection plan mode stays active and you should ' +
      'refine the plan based on the rejection reason. Errors in non-TTY environments ' +
      '(CI, --prompt one-shot) — in that case present the markdown plan and ask the user ' +
      'to leave plan mode manually with `/plan off`.',
    parameters: {
      type: 'object',
      properties: {
        allowedPrompts: {
          type: 'array',
          description:
            'Optional list of the next tool calls you intend to run after approval ' +
            '(informational only — surfaced to the user so they know what they are ' +
            'signing off on). Max 16 items.',
          items: {
            type: 'object',
            properties: {
              tool: {
                type: 'string',
                description: 'Tool name you intend to call (e.g., "create_file", "bash")',
              },
              prompt: {
                type: 'string',
                description: 'Short description of the intended call (≤500 chars)',
              },
            },
            required: ['tool', 'prompt'],
          },
        },
        planSummary: {
          type: 'string',
          description:
            'Optional inline plan text shown to the user when no plan markdown file ' +
            'has been registered. Keep ≤8000 chars.',
        },
      },
      required: [],
    },
  },
};

export const EXIT_PLAN_MODE_TOOLS: CodeBuddyTool[] = [EXIT_PLAN_MODE_TOOL];
