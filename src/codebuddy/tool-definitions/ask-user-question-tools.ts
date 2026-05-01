/**
 * AskUserQuestion Tool Definitions
 *
 * OpenAI function calling schema for the ask_user_question tool.
 * Lets the LLM ask 1–4 structured multi-option questions to the user
 * in the middle of a task.
 */

import type { CodeBuddyTool } from './types.js';

export const ASK_USER_QUESTION_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'ask_user_question',
    description:
      'Pause execution and ask the user 1–4 structured multi-option questions. ' +
      'Use when (a) requirements are ambiguous and the wrong choice would waste effort, ' +
      '(b) the user needs to decide between mutually exclusive approaches, or ' +
      '(c) a destructive/irreversible action requires explicit sign-off. ' +
      'Each question has a short header (chip label ≤12 chars), the full question text, ' +
      '2–4 options each with label+description, and an optional multiSelect flag. ' +
      'Returns a JSON object mapping each question header to the user\'s answer. ' +
      'Note: in non-TTY environments (CI, --prompt one-shot) the tool returns an ' +
      'error so you can auto-decide instead.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: '1–4 questions to ask the user. Each is independent.',
          items: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'The full question text, ending with a question mark',
              },
              header: {
                type: 'string',
                description: 'Short chip label (max 12 chars). Used as key in the result map.',
              },
              options: {
                type: 'array',
                description: '2–4 options the user can pick from',
                items: {
                  type: 'object',
                  properties: {
                    label: {
                      type: 'string',
                      description: 'Short display label (1–5 words)',
                    },
                    description: {
                      type: 'string',
                      description: 'Explanation of what this option means or its trade-off',
                    },
                    preview: {
                      type: 'string',
                      description: 'Optional preview content (mockup, code snippet)',
                    },
                  },
                  required: ['label', 'description'],
                },
              },
              multiSelect: {
                type: 'boolean',
                description: 'When true, allow multiple answers (comma-separated)',
              },
            },
            required: ['question', 'header', 'options'],
          },
        },
      },
      required: ['questions'],
    },
  },
};

export const ASK_USER_QUESTION_TOOLS: CodeBuddyTool[] = [ASK_USER_QUESTION_TOOL];
