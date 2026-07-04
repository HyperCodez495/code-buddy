/**
 * Manus AI error preservation in the FALLBACK compaction path
 * (`SmartCompactionEngine.createSummary`).
 *
 * This engine is what `retry-fallback.ts` calls when the provider rejects a
 * request for context-length overflow (`compact()` → aggressive strategy →
 * `createSummary`). Its extractive summary used to only look at user/assistant
 * string content, silently dropping every `role:'tool'` message — so FAILED
 * tool attempts were lost on this fallback and the agent could blindly retry a
 * call it already knows is broken.
 *
 * These deterministic tests (no LLM — GEMINI/GOOGLE keys cleared so the
 * extractive branch runs) drive the real public `compact()` entry point with a
 * tiny token budget to force the aggressive summary, and assert failed tool
 * attempts survive, successes stay out, and the section is bounded — mirroring
 * `context-manager-v2-tool-failures.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { SmartCompactionEngine, type Message } from '../../src/context/smart-compaction.js';

function user(content: string): Message {
  return { role: 'user', content };
}
function assistant(content: string): Message {
  return { role: 'assistant', content };
}
/** Assistant message that requested a tool call (OpenAI shape). */
function assistantToolCall(id: string, name: string): Message {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [{ id, type: 'function', function: { name, arguments: '{}' } }],
  };
}
function toolResult(toolCallId: string, content: string): Message {
  return { role: 'tool', tool_call_id: toolCallId, content };
}

describe('SmartCompactionEngine fallback summary — failed tool preservation', () => {
  let engine: SmartCompactionEngine;
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    // Ensure the deterministic extractive branch runs (no Gemini rewrite).
    process.env = { ...ORIGINAL_ENV };
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;
    // Tiny budget forces the 'aggressive' strategy => createSummary over ALL
    // non-system messages. Provider 'openai' allows empty content, so the
    // null-content assistant tool-call messages survive sanitization and the
    // tool_call_id → name attribution works.
    engine = new SmartCompactionEngine({ maxTokens: 10, provider: 'openai', channelType: 'cli' });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  /** Run the real fallback path and return the aggressive summary text. */
  async function summaryOf(messages: Message[]): Promise<string> {
    const { messages: out, result } = await engine.compact(messages);
    expect(result.strategy).toBe('aggressive');
    const summaryMsg = out.find(
      (m) => typeof m.content === 'string' && m.content.includes('[Conversation context:'),
    );
    expect(summaryMsg, 'expected an aggressive [Conversation context: …] summary message').toBeDefined();
    return summaryMsg!.content as string;
  }

  it('preserves the error text AND the tool name of a failed tool_result', async () => {
    const messages: Message[] = [
      user('Run the build'),
      assistantToolCall('call_1', 'run_shell'),
      toolResult('call_1', 'Error: command "npm run buildz" exited with code 127 — DISTINCT_FAILURE_XYZ'),
      assistant('The build script name is wrong.'),
    ];

    const summary = await summaryOf(messages);

    expect(summary).toContain('Failed tool attempts (do not retry):');
    expect(summary).toContain('DISTINCT_FAILURE_XYZ');
    expect(summary).toContain('run_shell');
  });

  it('does not list a SUCCESSFUL tool_result as a failure (no noise)', async () => {
    const messages: Message[] = [
      user('Read the config'),
      assistantToolCall('call_ok', 'read_file'),
      toolResult('call_ok', '{"success": true, "output": "SUCCESS_NOISE_MARKER read 3 lines OK"}'),
      assistant('Config read successfully.'),
    ];

    const summary = await summaryOf(messages);

    expect(summary).not.toContain('Failed tool attempts');
    // Successful tool payload is dropped entirely (role:'tool' successes are noise).
    expect(summary).not.toContain('SUCCESS_NOISE_MARKER');
  });

  it('keeps failures but ignores successes when both are present', async () => {
    const messages: Message[] = [
      user('Do the work'),
      assistantToolCall('ok1', 'list_directory'),
      toolResult('ok1', '{"success": true, "output": "SUCCESS_NOISE_MARKER 4 entries"}'),
      assistantToolCall('bad1', 'apply_patch'),
      toolResult('bad1', 'Error: hunk #2 FAILED to apply — DISTINCT_PATCH_FAILURE'),
      assistant('Patch did not apply.'),
    ];

    const summary = await summaryOf(messages);

    expect(summary).toContain('Failed tool attempts (do not retry):');
    expect(summary).toContain('DISTINCT_PATCH_FAILURE');
    expect(summary).toContain('apply_patch');
    expect(summary).not.toContain('SUCCESS_NOISE_MARKER');
  });

  it('bounds the section to the last N failures and truncates long errors', async () => {
    const messages: Message[] = [user('Try many things')];
    // 7 distinct failures; only the last 5 must survive (N = 5).
    for (let i = 1; i <= 7; i++) {
      messages.push(assistantToolCall(`c${i}`, `tool_${i}`));
      messages.push(toolResult(`c${i}`, `Error: attempt ${i} failed — FAILMARK_${i}`));
    }
    // A very long failure to prove the per-entry char bound (~200) truncates.
    messages.push(assistantToolCall('big', 'huge_tool'));
    messages.push(toolResult('big', 'Error: ' + 'A'.repeat(300) + ' TAILMARKER_DROPPED'));
    messages.push(assistant('done trying'));

    const summary = await summaryOf(messages);

    expect(summary).toContain('Failed tool attempts (do not retry):');

    // Only the last 5 failures kept: earliest dropped, latest present.
    expect(summary).not.toContain('FAILMARK_1');
    expect(summary).not.toContain('FAILMARK_2');
    expect(summary).toContain('FAILMARK_7');

    // Exactly 5 bullet lines under the header.
    const bulletLines = summary.split('\n').filter((line) => line.startsWith('- '));
    expect(bulletLines.length).toBe(5);

    // The long error's tail (beyond ~200 chars) is truncated, head survives.
    expect(summary).toContain('huge_tool');
    expect(summary).not.toContain('TAILMARKER_DROPPED');
  });

  it('adds no empty/parasitic section when there are no tool failures', async () => {
    const messages: Message[] = [
      user('Just chatting'),
      assistant('Sure, hello!'),
      user('How are you?'),
      assistant('Doing well, thanks.'),
    ];

    const summary = await summaryOf(messages);
    expect(summary).not.toContain('Failed tool attempts');
  });
});
