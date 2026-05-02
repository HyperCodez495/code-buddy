/**
 * Session tool definitions — re-export the 4 SESSION_TOOLS from the
 * multi-agent module so they appear in Code Buddy's main tool registry.
 *
 * The actual tool definitions (sessions_list / sessions_history /
 * sessions_send / sessions_spawn) live in
 * `src/agent/multi-agent/session-tools.ts` alongside the SessionToolExecutor
 * that runs them. This file just bridges the namespace.
 *
 * Wired Phase E (audit OpenClaw heritage activation): exposes session
 * coordination as LLM-callable tools instead of slash-only.
 */

export { SESSION_TOOLS } from '../../agent/multi-agent/session-tools.js';
