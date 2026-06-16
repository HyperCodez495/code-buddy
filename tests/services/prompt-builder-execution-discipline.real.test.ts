/**
 * REAL (no-mock) integration test for the execution-discipline prompt block.
 *
 * The sibling spec `prompt-builder-query-aware.test.ts` mocks `model-tools` and
 * `prompts/index` to isolate the gating matrix. This file does the opposite: it
 * mocks NOTHING. It constructs a real `PromptBuilder` with a real
 * `PromptCacheManager`, points `cwd` at the actual repository (so persona /
 * identity / knowledge / project-docs / skills all load for real — the realistic
 * worst case for prompt length + truncation), and asserts the
 * execution-discipline block is on the genuine production prompt path AND
 * survives head-truncation for the models we actually ship with.
 *
 * Addresses the advisor concern that the mocked spec proves *wiring* but not
 * that the block lands, intact, in the bytes a real model receives.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { PromptBuilder, type PromptBuilderConfig } from '../../src/services/prompt-builder.js';
import { PromptCacheManager } from '../../src/optimization/prompt-cache.js';
import { getModelToolConfig } from '../../src/config/model-tools.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The full, last line of the block — its presence proves the block was not
// chopped by head-truncation (which keeps the FRONT and drops the tail).
const BLOCK_HEADER = '## Execution discipline';
const BLOCK_LAST_LINE = 'Scope (no unintended file changes?).';

function realBuilder(): PromptBuilder {
  const config: PromptBuilderConfig = {
    yoloMode: false,
    memoryEnabled: true,
    morphEditorEnabled: false,
    cwd: REPO_ROOT, // real repo → real CODEBUDDY.md, docs, persona, etc.
  };
  // Real cache manager, real everything else. No constructor stubs.
  return new PromptBuilder(config, new PromptCacheManager());
}

/** Replicates prompt-builder.ts:660-663 budget math for an assertion. */
function budgetChars(model: string): number {
  const cfg = getModelToolConfig(model);
  const ctx = cfg.contextWindow ?? 8192;
  const out = cfg.maxOutputTokens ?? 2048;
  const budgetTokens = Math.min(Math.floor((ctx - out) * 0.5), 32_000);
  return budgetTokens * 4;
}

describe('execution-discipline block — REAL prompt assembly (no mocks)', () => {
  it('gpt-5.5 (rich, shipping ChatGPT model): block present AND not truncated', async () => {
    const sp = await realBuilder().buildForQuery(
      'Refactor the auth module across src/auth/jwt.ts and src/auth/session.ts, ' +
        'then add a vitest that covers refresh-token rotation and prove it passes.',
      undefined,
      'gpt-5.5',
      null,
    );

    // 1. Block is on the genuine production path.
    expect(sp).toContain(BLOCK_HEADER);
    // 2. The block's FINAL line survived → head-truncation did not chop it.
    expect(sp).toContain(BLOCK_LAST_LINE);
    // 3. The assembled prompt is comfortably under the model's char budget,
    //    so no truncation fired at all for the real repo's worst-case context.
    expect(sp.length).toBeLessThan(budgetChars('gpt-5.5'));
    // 4. The header appears before the block's tail (sanity: contiguous block).
    expect(sp.indexOf(BLOCK_HEADER)).toBeLessThan(sp.indexOf(BLOCK_LAST_LINE));
  });

  it('gpt-5.5: full block content is intact (anti-stub + persistence + mandatory-tool + self-check)', async () => {
    const sp = await realBuilder().buildForQuery(
      'Implement a util that parses ISO durations and verify it with tests.',
      undefined,
      'gpt-5.5',
      null,
    );
    // Every load-bearing clause of the Hermes-derived guidance must be present
    // in the bytes the model receives — not just the header.
    expect(sp).toMatch(/working artifact backed by real tool output/);
    expect(sp).toMatch(/Do not stop after writing a stub/);
    expect(sp).toMatch(/Keep using tools until/);
    expect(sp).toMatch(/Never guess or fabricate tool output/);
    expect(sp).toMatch(/Before finalizing, self-check/);
  });

  it('qwen2.5-coder:7b (lite + no tool calls): block suppressed (double force-off)', async () => {
    const sp = await realBuilder().buildForQuery(
      'Refactor the entire codebase to functional patterns and add tests',
      undefined,
      'qwen2.5-coder:7b',
      null,
    );
    // lite profile → trivial gates AND supportsToolCalls=false force-off.
    // Telling a chat-only model to "use tools" invites JSON-call hallucination.
    expect(sp).not.toContain(BLOCK_HEADER);
  });

  it('standard model + trivial query "hi": block suppressed', async () => {
    const sp = await realBuilder().buildForQuery('hi', undefined, 'mistral-large', null);
    // standard profile → classifyQuery('hi') = trivial → block off.
    expect(sp).not.toContain(BLOCK_HEADER);
  });

  it('gpt-5.5: block is CONTIGUOUS — not fragmented by the variation injector', async () => {
    // Regression guard: the block was originally appended near the footer, where
    // varySystemPrompt() shuffles bullet-line "reminder" blocks. That interleaved
    // foreign bullets (e.g. tool param docs, user-model directive lines) between
    // its lines. The block now lives in the stable prefix, so the EXACT block text
    // returned by getExecutionDisciplineBlock() must appear verbatim/contiguous.
    const { getExecutionDisciplineBlock } = await import(
      '../../src/prompts/execution-discipline.js'
    );
    const fullBlock = getExecutionDisciplineBlock();

    const sp = await realBuilder().buildForQuery(
      'Refactor auth across two files and add a passing test, then run the suite',
      undefined,
      'gpt-5.5',
      null,
    );

    // The whole block, intact and uninterrupted, is present.
    expect(sp).toContain(fullBlock);
    // And it sits in the stable prefix (well before the variation footer / the
    // shuffled directives), so it is cache- and truncation-resistant.
    expect(sp.indexOf(BLOCK_HEADER)).toBeLessThan(sp.length * 0.5);
  });

  it('gpt-5.5: Verification Contract (workflow-rules) is NOT fragmented by the variation injector', async () => {
    // Regression for the variation-injector heading-atomic fix. The `### When to
    // Plan` bullets are tool-gating-independent (workflow-rules.ts:121-126) and
    // carry no PHRASING_POOLS phrase, so they must appear verbatim/contiguous in
    // the REAL assembled prompt (variation runs for complex/rich gates).
    const sp = await realBuilder().buildForQuery(
      'Refactor auth across two files, add a passing test, and run the suite',
      undefined,
      'gpt-5.5',
      null,
    );
    const span = [
      'PLAN BEFORE ACTING when ANY of the following is true:',
      '- Creating a new file or module',
      '- Touching 3 or more existing files',
      '- Changing a public API, type signature, or database schema',
    ].join('\n');
    expect(sp).toContain(span);
  });

  it('standard model + complex code query: block present', async () => {
    const sp = await realBuilder().buildForQuery(
      'fix the failing test in src/parser/lexer.ts, run the suite, and report the results',
      undefined,
      'mistral-large',
      null,
    );
    expect(sp).toContain(BLOCK_HEADER);
    expect(sp).toContain(BLOCK_LAST_LINE);
  });
});
