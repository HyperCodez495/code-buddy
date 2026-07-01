/**
 * Default reviewer client — resolves a real LLM from the active pool for
 * `full`-mode reviews when the caller didn't inject one (the apply_patch
 * bridge). Strong-model name heuristic, dead models skipped via the
 * scoreboard's trailing-failure streak (same discipline as the council
 * judge). Lazy imports keep this graph out of the tool's off path; any
 * failure → null → the engine fails closed.
 *
 * @module review/llm-client
 */

import type { CouncilChatClient } from '../council/types.js';

const STRONG_REVIEWER_PATTERN = /gpt-5|opus|sonnet|fable|gemini|grok-[34]/;
const DEAD_AFTER_FAILURES = 2;

export async function resolveDefaultReviewClient(): Promise<CouncilChatClient | null> {
  try {
    const [{ listActiveLlmModelPool }, { CodeBuddyClient }, { getModelScoreboard }] = await Promise.all([
      import('../providers/active-llm-model-pool.js'),
      import('../codebuddy/client.js'),
      import('../fleet/model-scoreboard.js'),
    ]);
    const pool = await listActiveLlmModelPool();
    const scoreboard = getModelScoreboard();
    const pick = pool.find(
      (p) =>
        p.apiKey &&
        STRONG_REVIEWER_PATTERN.test(p.model.toLowerCase()) &&
        scoreboard.consecutiveRecentFailures(p.model) < DEAD_AFTER_FAILURES,
    );
    if (!pick) return null;

    const raw = new CodeBuddyClient(pick.apiKey ?? '', pick.model, pick.baseURL);
    return {
      async chat(messages) {
        const resp = await raw.chat(messages, []);
        return {
          content: resp?.choices?.[0]?.message?.content ?? '',
          promptTokens: resp?.usage?.prompt_tokens ?? 0,
          totalTokens: resp?.usage?.total_tokens ?? 0,
        };
      },
    };
  } catch {
    return null;
  }
}
