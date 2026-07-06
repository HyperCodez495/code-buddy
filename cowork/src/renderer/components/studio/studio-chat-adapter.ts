/**
 * Map a Cowork agent session's messages into the StudioChatPanel's lightweight
 * StudioMessage shape (bolt.new-style iterate chat). Pure + structurally typed
 * so it needs no store/session imports and is trivially testable.
 */
import type { StudioMessage } from '../studio-iterate/iterate-model.js';

export interface ChatSourceMessage {
  id: string;
  role: string; // 'user' | 'assistant' | 'system'
  content: ReadonlyArray<{ type: string; text?: string }>;
}

function textOf(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
}

/**
 * Keep only user/assistant messages that carry visible text; mark the last
 * assistant bubble as streaming while the turn is running.
 */
export function sessionToStudioMessages(
  messages: ReadonlyArray<ChatSourceMessage>,
  opts: { running?: boolean } = {},
): StudioMessage[] {
  const out: StudioMessage[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = textOf(m.content);
    if (!text) continue;
    out.push({ id: m.id, role: m.role, text });
  }
  if (opts.running) {
    const last = out[out.length - 1];
    if (last && last.role === 'assistant') last.streaming = true;
  }
  return out;
}
