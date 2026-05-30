import type { CodeBuddyTool } from './types.js';

export const CRONJOB_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'cronjob',
    description:
      'Manage Code Buddy scheduled jobs through the real CronScheduler store: list, show, create, pause, resume, run, or remove jobs.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'show', 'create', 'pause', 'resume', 'run', 'remove'],
          description: 'Cron job action to perform.',
        },
        id: {
          type: 'string',
          description: 'Job id or unique id prefix for show, pause, resume, run, or remove.',
        },
        name: {
          type: 'string',
          description: 'Job name when creating a job.',
        },
        every: {
          type: 'number',
          description: 'Create an interval job that runs every N milliseconds.',
        },
        cron: {
          type: 'string',
          description: 'Create a cron-expression job using a 5-field cron expression.',
        },
        at: {
          type: 'string',
          description: 'Create a one-shot job for an ISO 8601 timestamp.',
        },
        message: {
          type: 'string',
          description: 'Agent message task for create. Required unless watchdog is provided.',
        },
        watchdog: {
          type: 'object',
          description: 'No-LLM watchdog task config for create, for example disk/http/repo/build checks.',
        },
        preCheck: {
          type: 'object',
          description: 'Optional file_changed or command pre-check gate for create.',
        },
        deliver: {
          type: 'array',
          description: 'Optional delivery targets such as telegram:123 or discord:channel.',
          items: {
            type: 'string',
            description: 'Delivery target in type:id form.',
          },
        },
        format: {
          type: 'string',
          enum: ['full', 'summary'],
          description: 'Optional delivery body format for created jobs.',
        },
      },
      required: ['action'],
    },
  },
};

export const CRON_TOOLS = [CRONJOB_TOOL];
