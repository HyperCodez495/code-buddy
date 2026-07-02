/**
 * Transcript repair hardening — the canonical-rebuild cases the original
 * implementation passed through malformed: id-less tool_calls, duplicate
 * call ids, duplicate results, result-before-call ordering, idempotence.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { repairToolCallPairs } from '../../src/context/transcript-repair.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';

function assistantWithCalls(ids: Array<string | undefined>, content = ''): CodeBuddyMessage {
  return {
    role: 'assistant',
    content,
    tool_calls: ids.map((id, i) => ({
      ...(id !== undefined ? { id } : {}),
      type: 'function',
      function: { name: 'view_file', arguments: `{"n":${i}}` },
    })),
  } as CodeBuddyMessage;
}

function toolResult(id: string, content = 'ok'): CodeBuddyMessage {
  return { role: 'tool', tool_call_id: id, content } as CodeBuddyMessage;
}

const user = (content: string): CodeBuddyMessage => ({ role: 'user', content });

/** Provider contract: every result directly follows the assistant that called it. */
function isCanonical(messages: CodeBuddyMessage[]): boolean {
  const pendingResults: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'tool') {
      const id = (msg as { tool_call_id?: string }).tool_call_id;
      if (pendingResults[0] !== id) return false;
      pendingResults.shift();
      continue;
    }
    if (pendingResults.length > 0) return false; // results must be adjacent
    const calls = (msg as { tool_calls?: Array<{ id?: string }> }).tool_calls;
    if (Array.isArray(calls)) {
      if (calls.length === 0) return false; // empty tool_calls array is malformed
      for (const c of calls) {
        if (!c.id) return false;
        pendingResults.push(c.id);
      }
    }
  }
  return pendingResults.length === 0;
}

describe('repairToolCallPairs — hardening (canonical rebuild)', () => {
  it('strips id-less tool_calls; an assistant left with none loses the property', () => {
    const input = [user('q'), assistantWithCalls([undefined], 'thinking')];
    const repaired = repairToolCallPairs(input);

    expect(repaired).toHaveLength(2);
    expect((repaired[1] as { tool_calls?: unknown }).tool_calls).toBeUndefined();
    expect(isCanonical(repaired)).toBe(true);
  });

  it('keeps the pairable calls when only SOME calls of an assistant are id-less', () => {
    const input = [user('q'), assistantWithCalls(['tc-1', undefined]), toolResult('tc-1')];
    const repaired = repairToolCallPairs(input);

    const calls = (repaired[1] as { tool_calls: Array<{ id?: string }> }).tool_calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]!.id).toBe('tc-1');
    expect(isCanonical(repaired)).toBe(true);
  });

  it('duplicate tool_call ids across assistants: first occurrence wins, the duplicate is stripped', () => {
    const input = [
      user('q'),
      assistantWithCalls(['tc-1']),
      toolResult('tc-1', 'first'),
      assistantWithCalls(['tc-1'], 'retry'), // corrupted duplicate id
    ];
    const repaired = repairToolCallPairs(input);

    const withCalls = repaired.filter((m) => Array.isArray((m as { tool_calls?: unknown[] }).tool_calls));
    expect(withCalls).toHaveLength(1); // the duplicate lost its (only) call
    expect(repaired.filter((m) => m.role === 'tool')).toHaveLength(1);
    expect(isCanonical(repaired)).toBe(true);
  });

  it('duplicate results for one id: first wins, later duplicates dropped', () => {
    const input = [
      user('q'),
      assistantWithCalls(['tc-1']),
      toolResult('tc-1', 'first'),
      toolResult('tc-1', 'second (duplicate)'),
    ];
    const repaired = repairToolCallPairs(input);

    const results = repaired.filter((m) => m.role === 'tool');
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe('first');
    expect(isCanonical(repaired)).toBe(true);
  });

  it('relocates a result that appeared BEFORE its call to the canonical slot', () => {
    const input = [
      user('q'),
      toolResult('tc-1', 'early'), // corrupted ordering
      assistantWithCalls(['tc-1']),
    ];
    const repaired = repairToolCallPairs(input);

    expect(isCanonical(repaired)).toBe(true);
    const assistantIdx = repaired.findIndex((m) => Array.isArray((m as { tool_calls?: unknown[] }).tool_calls));
    expect(repaired[assistantIdx + 1]!.role).toBe('tool');
    expect(repaired[assistantIdx + 1]!.content).toBe('early'); // real result kept, not a synthetic
  });

  it('multi-call assistant where only some results survived: real results kept, synthetics for the rest', () => {
    const input = [
      user('q'),
      assistantWithCalls(['tc-1', 'tc-2', 'tc-3']),
      toolResult('tc-2', 'survivor'),
    ];
    const repaired = repairToolCallPairs(input);

    const results = repaired.filter((m) => m.role === 'tool');
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.content)).toEqual([
      '[result lost during compaction]',
      'survivor',
      '[result lost during compaction]',
    ]);
    expect(isCanonical(repaired)).toBe(true);
  });

  it('is idempotent: repairing a repaired transcript is byte-identical', () => {
    // Every corruption class at once: result-before-call, id-less call,
    // orphan result, duplicate call id, duplicate result.
    const input = [
      user('q'),
      toolResult('tc-0', 'early'),
      assistantWithCalls(['tc-0', undefined, 'tc-1']),
      toolResult('tc-orphan'),
      assistantWithCalls(['tc-1'], 'retry'),
      toolResult('tc-1', 'first'),
      toolResult('tc-1', 'second (duplicate)'),
    ];
    const once = repairToolCallPairs(input);
    const twice = repairToolCallPairs(once);

    expect(twice).toEqual(once);
    expect(isCanonical(once)).toBe(true);
  });
});
