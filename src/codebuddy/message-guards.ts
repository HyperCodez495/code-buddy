import type { CodeBuddyMessage, CodeBuddyToolCall } from './client.js';

/** Assistant message that requested tool use. */
export interface CodeBuddyMessageWithToolCalls {
  role: 'assistant';
  content: string | null;
  tool_calls: CodeBuddyToolCall[];
}

/** Type guard for assistant messages with tool calls. */
export function hasToolCalls(msg: CodeBuddyMessage): msg is CodeBuddyMessageWithToolCalls {
  return (
    msg.role === 'assistant' &&
    'tool_calls' in msg &&
    Array.isArray((msg as CodeBuddyMessageWithToolCalls).tool_calls)
  );
}
