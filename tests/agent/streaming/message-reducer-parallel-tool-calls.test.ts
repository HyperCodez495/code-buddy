/**
 * Regression test for streaming tool-call delta accumulation.
 *
 * Bug (observed during a real headless run driving an MCP server with parallel
 * tool calls): when the model emits TWO tool calls in one streamed assistant
 * message, their streaming deltas were sometimes accumulated INTO ONE — producing
 * a tool call whose name is two names concatenated, and whose arguments are two
 * JSON objects back-to-back (causing "Unexpected non-whitespace character after
 * JSON" when parsed).
 *
 * Root cause: `reduceStreamChunk` merged the `tool_calls` array by positional
 * array index (the loop counter) instead of by each delta element's `index`
 * field. Each streamed chunk carries a single-element `tool_calls` array whose
 * element holds an `index` (0, 1, ...). Merging by loop position folds every
 * delta into slot 0, concatenating distinct tool calls.
 */

import { describe, it, expect } from 'vitest';
import { reduceStreamChunk } from '../../../src/agent/streaming/index.js';

interface ToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

/** Build an OpenAI-compatible streaming chunk carrying a single tool_call delta. */
function chunk(toolCalls: ToolCallDelta[]): unknown {
  return {
    id: 'chatcmpl-test',
    choices: [{ index: 0, delta: { tool_calls: toolCalls } }],
  };
}

describe('reduceStreamChunk - parallel tool-call accumulation', () => {
  it('keeps two parallel tool calls separate, keyed by delta index', () => {
    // Realistic delta sequence: each chunk has a single-element tool_calls array
    // whose element carries its `index`. function.name appears only in the first
    // chunk for a given index; arguments arrive as fragments. Interleaved to make
    // the positional-merge bug unmistakable.
    const deltas: ToolCallDelta[][] = [
      // index 0 — name + opening of args
      [{ index: 0, id: 'call_a', type: 'function', function: { name: 'mcp__pdfcommander__merge', arguments: '{"files":' } }],
      // index 1 — name + opening of args
      [{ index: 1, id: 'call_b', type: 'function', function: { name: 'mcp__pdfcommander__extract_pages', arguments: '{"pages":' } }],
      // index 0 — more args
      [{ index: 0, function: { arguments: '["a.pdf",' } }],
      // index 1 — more args
      [{ index: 1, function: { arguments: '"1-3"}' } }],
      // index 0 — closing args
      [{ index: 0, function: { arguments: '"b.pdf"]}' } }],
    ];

    let acc: Record<string, unknown> = {};
    for (const tcDelta of deltas) {
      acc = reduceStreamChunk(acc, chunk(tcDelta));
    }

    const toolCalls = acc.tool_calls as Array<{
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;

    // Two distinct tool calls, NOT one concatenated blob.
    expect(Array.isArray(toolCalls)).toBe(true);
    expect(toolCalls).toHaveLength(2);

    const [first, second] = toolCalls;

    // Names must be exact, not concatenated.
    expect(first?.function?.name).toBe('mcp__pdfcommander__merge');
    expect(second?.function?.name).toBe('mcp__pdfcommander__extract_pages');

    // Arguments must each be valid, parseable JSON (no back-to-back objects).
    expect(() => JSON.parse(first?.function?.arguments ?? '')).not.toThrow();
    expect(() => JSON.parse(second?.function?.arguments ?? '')).not.toThrow();
    expect(JSON.parse(first!.function!.arguments!)).toEqual({ files: ['a.pdf', 'b.pdf'] });
    expect(JSON.parse(second!.function!.arguments!)).toEqual({ pages: '1-3' });
  });

  it('handles non-interleaved deltas (all index 0, then all index 1)', () => {
    const deltas: ToolCallDelta[][] = [
      [{ index: 0, id: 'call_a', type: 'function', function: { name: 'mcp__pdfcommander__merge', arguments: '{"x":1}' } }],
      [{ index: 1, id: 'call_b', type: 'function', function: { name: 'mcp__pdfcommander__extract_pages', arguments: '{"y":2}' } }],
    ];

    let acc: Record<string, unknown> = {};
    for (const tcDelta of deltas) {
      acc = reduceStreamChunk(acc, chunk(tcDelta));
    }

    const toolCalls = acc.tool_calls as Array<{ function?: { name?: string; arguments?: string } }>;
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]?.function?.name).toBe('mcp__pdfcommander__merge');
    expect(toolCalls[1]?.function?.name).toBe('mcp__pdfcommander__extract_pages');
    expect(JSON.parse(toolCalls[0]!.function!.arguments!)).toEqual({ x: 1 });
    expect(JSON.parse(toolCalls[1]!.function!.arguments!)).toEqual({ y: 2 });
  });

  it('preserves single tool-call accumulation (no regression)', () => {
    const deltas: ToolCallDelta[][] = [
      [{ index: 0, id: 'call_solo', type: 'function', function: { name: 'view_file', arguments: '{"path":' } }],
      [{ index: 0, function: { arguments: '"a.ts"}' } }],
    ];

    let acc: Record<string, unknown> = {};
    for (const tcDelta of deltas) {
      acc = reduceStreamChunk(acc, chunk(tcDelta));
    }

    const toolCalls = acc.tool_calls as Array<{ function?: { name?: string; arguments?: string } }>;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]?.function?.name).toBe('view_file');
    expect(JSON.parse(toolCalls[0]!.function!.arguments!)).toEqual({ path: 'a.ts' });
  });

  it('preserves content-only accumulation (no tool calls)', () => {
    const c1 = { id: 'x', choices: [{ index: 0, delta: { content: 'Hello, ' } }] };
    const c2 = { id: 'x', choices: [{ index: 0, delta: { content: 'world' } }] };

    let acc: Record<string, unknown> = {};
    acc = reduceStreamChunk(acc, c1);
    acc = reduceStreamChunk(acc, c2);

    expect(acc.content).toBe('Hello, world');
    expect(acc.tool_calls).toBeUndefined();
  });
});
