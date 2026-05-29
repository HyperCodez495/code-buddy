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

/** Min user turns before a session is "substantial" enough to auto-infer (D1). */
export const AUTO_INFER_MIN_USER_MESSAGES = 6;

/**
 * D1 — decide whether to auto-run user-model dialectic inference when a session
 * goes terminal. Guarded so it fires AT MOST ONCE per session and only for
 * substantial conversations (bounds the extra LLM call; the advisor's cost
 * concern). Inference only PROPOSES review-gated observations — never writes.
 */
export function shouldAutoInferUserModel(args: {
  status: string;
  userMessageCount: number;
  alreadyInferred: boolean;
}): boolean {
  if (args.alreadyInferred) return false;
  if (args.status !== 'idle' && args.status !== 'completed') return false;
  return args.userMessageCount >= AUTO_INFER_MIN_USER_MESSAGES;
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
