/**
 * Yield Coordinator — `__SESSIONS_YIELD__` signal handling for sub-agent
 * suspension.
 *
 * When a tool result contains the __SESSIONS_YIELD__ marker, the parent
 * agent suspends itself until the named sub-agent completes. The sub-agent
 * result is then injected as a user message into the parent's conversation,
 * and the parent resumes its turn loop.
 *
 * Both sequential and streaming paths use this helper. The streaming path
 * additionally yields a UI hint before the await — that hint stays at the
 * call site (this module is yield-agnostic so it can be called from both
 * generators and plain async functions).
 *
 * @module agent/execution/yield-coordinator
 */

import type { CodeBuddyMessage } from '../../codebuddy/client.js';

/** Marker string a tool result writes to request parent suspension. */
export const YIELD_SIGNAL = '__SESSIONS_YIELD__';

/** Pattern matching the sub-agent id in the yield payload. */
const CHILD_ID_PATTERN = /"id"\s*:\s*"(agent-\d+)"/;

/** Default time the parent will wait for the sub-agent before timing out. */
export const YIELD_DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Detect a yield signal in raw tool content and extract the sub-agent id.
 * Returns null if no yield signal is present or the id can't be parsed.
 */
export function extractYieldChildId(rawContent: string): string | null {
  if (!rawContent.includes(YIELD_SIGNAL)) return null;
  const match = rawContent.match(CHILD_ID_PATTERN);
  return match?.[1] ?? null;
}

/**
 * Suspend the parent until the sub-agent completes, then push the result
 * as a user message into `messages`. Errors and timeouts surface as a
 * `[Sub-agent yield timeout]` user message — never thrown.
 */
export async function processYieldSignal(
  childId: string,
  messages: CodeBuddyMessage[],
  timeoutMs: number = YIELD_DEFAULT_TIMEOUT_MS
): Promise<void> {
  try {
    const { waitForSingleAgent } = await import('../multi-agent/agent-tools.js');
    const completed = await waitForSingleAgent(childId, timeoutMs);
    const yieldResult = completed.result || 'Sub-agent completed (no result).';
    messages.push({
      role: 'user',
      content: `[Sub-agent ${completed.nickname} completed]: ${yieldResult}`,
    } as CodeBuddyMessage);
  } catch (err) {
    messages.push({
      role: 'user',
      content: `[Sub-agent yield timeout]: ${err instanceof Error ? err.message : String(err)}`,
    } as CodeBuddyMessage);
  }
}
