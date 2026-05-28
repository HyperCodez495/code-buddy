/**
 * Pure helper for S3 user-model dialectic inference: convert Cowork session
 * messages into the minimal transcript shape the core
 * `runUserDialecticInference(chatHistory)` consumes ({ type, content }).
 *
 * @module renderer/components/user-model-inference
 */

import type { Message } from '../types';

export interface InferenceHistoryEntry {
  type: 'user' | 'assistant';
  content: string;
}

/** Flatten messages to user/assistant text turns, dropping empty/non-text turns. */
export function toInferenceHistory(messages: Message[]): InferenceHistoryEntry[] {
  const out: InferenceHistoryEntry[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = m.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (text) out.push({ type: m.role, content: text });
  }
  return out;
}
