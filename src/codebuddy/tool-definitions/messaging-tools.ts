import { SEND_MESSAGE_CHANNELS } from '../../channels/send-message.js';
import type { CodeBuddyTool } from './types.js';

export const SEND_MESSAGE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'send_message',
    description: 'Prepare or deliver an outbound channel message with dry-run outbox logging by default',
    parameters: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          enum: [...SEND_MESSAGE_CHANNELS],
          description: 'Target channel type',
        },
        channel_id: {
          type: 'string',
          description: 'Target channel, chat, room, conversation, or recipient id',
        },
        content: {
          type: 'string',
          description: 'Message body to send or preview',
        },
        content_type: {
          type: 'string',
          enum: ['text', 'image', 'audio', 'video', 'file', 'location', 'contact', 'sticker', 'voice', 'command'],
          description: 'Message content type, default text',
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview only and write to the local outbox; defaults to true',
        },
        approved_by: {
          type: 'string',
          description: 'Required when dry_run is false; records who approved external delivery',
        },
        parse_mode: {
          type: 'string',
          enum: ['markdown', 'html', 'plain'],
          description: 'Optional formatting mode',
        },
        thread_id: {
          type: 'string',
          description: 'Optional thread/topic id',
        },
        reply_to: {
          type: 'string',
          description: 'Optional message id to reply to',
        },
        disable_preview: {
          type: 'boolean',
          description: 'Disable link previews where supported',
        },
        silent: {
          type: 'boolean',
          description: 'Send without notification where supported',
        },
        peer_id: {
          type: 'string',
          description: 'Optional peer id for send-policy evaluation',
        },
        chat_type: {
          type: 'string',
          enum: ['dm', 'group', 'thread'],
          description: 'Optional chat type for send-policy evaluation',
        },
      },
      required: ['channel', 'channel_id', 'content'],
    },
  },
};

export const MESSAGING_TOOLS: CodeBuddyTool[] = [
  SEND_MESSAGE_TOOL,
];
