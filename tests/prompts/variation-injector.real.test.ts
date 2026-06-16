/**
 * REAL (no-mock) regression test for the variation-injector fragmentation bug.
 *
 * Before the fix, `varySystemPrompt()` → `extractBlocks()` split the variable
 * footer region at every BULLET line, so the Fisher-Yates shuffle in
 * `applyVariation()` interleaved foreign bullets (e.g. tool-parameter docs) into
 * the middle of a `##`-headed block such as the Verification Contract
 * (`## Workflow Orchestration`), corrupting structured guidance. The fix makes
 * `extractBlocks()` heading-atomic (`##`/`###` boundaries) so whole sections are
 * shuffled, never fragmented.
 *
 * No mocks: real `varySystemPrompt`/`extractBlocks` + the real
 * `getWorkflowRulesBlock()` output.
 */
import { describe, it, expect } from 'vitest';
import {
  varySystemPrompt,
  extractBlocks,
} from '../../src/prompts/variation-injector.js';
import { getWorkflowRulesBlock } from '../../src/prompts/workflow-rules.js';

// A tool-gating-INDEPENDENT contiguous span inside `### When to Plan`
// (workflow-rules.ts:121-126 — these lines don't vary with isToolAvailable and
// contain no PHRASING_POOLS canonical phrase, so they must survive verbatim).
const WHEN_TO_PLAN_SPAN = [
  'PLAN BEFORE ACTING when ANY of the following is true:',
  '- Creating a new file or module',
  '- Touching 3 or more existing files',
  '- Changing a public API, type signature, or database schema',
  '- The request contains 3+ distinct action verbs (create, fix, update, test, deploy, refactor, implement, migrate, add, remove…)',
  '- An architectural decision with no single obvious solution',
].join('\n');

const FOREIGN_BLOCK = [
  '## Tool Parameters',
  '- `elementId` (string) - Element identifier',
  '- `script` (string, required) - The script source code to execute',
  '- `device` (string) - Device name to emulate',
].join('\n');

// `## Guidelines` matches the blockStart marker (/Guideline/i), forcing the
// variable region to begin here so variation actually runs over our blocks.
function buildSyntheticPrompt(): string {
  return [
    'You are a helpful coding agent. (stable prefix)',
    '',
    '## Guidelines',
    '- Prefer small, focused changes',
    '- Use the available tools',
    '- Explain your reasoning',
    '',
    getWorkflowRulesBlock({ isToolAvailable: () => true }),
    '',
    FOREIGN_BLOCK,
  ].join('\n');
}

describe('variation-injector — heading-atomic (no fragmentation)', () => {
  it('extractBlocks groups by ##/### heading and keeps >= 3 blocks (variation stays active)', () => {
    const prompt = buildSyntheticPrompt();
    const { blocks } = extractBlocks(prompt);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    // No block straddles two `##`/`###` headings (each block has at most one
    // heading line, at its start).
    for (const block of blocks) {
      const headingLines = block
        .split('\n')
        .filter((l) => /^#{2,3}\s+/.test(l.trim()));
      expect(headingLines.length).toBeLessThanOrEqual(1);
    }
  });

  it('shuffle never interleaves foreign bullets into the Verification Contract block', () => {
    const prompt = buildSyntheticPrompt();
    // Try several seeds — contiguity must hold for ANY shuffle ordering.
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const varied = varySystemPrompt(prompt, {
        seed,
        shuffleOrder: true,
        alternativePhrasing: false, // isolate the shuffle/fragmentation behaviour
        variationRate: 1,
      });
      // The When-to-Plan span survives verbatim and contiguous.
      expect(varied).toContain(WHEN_TO_PLAN_SPAN);
      // And no foreign tool-param bullet leaked between its lines.
      const start = varied.indexOf('PLAN BEFORE ACTING when ANY');
      const end = varied.indexOf('An architectural decision with no single obvious solution');
      const region = varied.slice(start, end);
      expect(region).not.toContain('elementId');
      expect(region).not.toContain('Device name to emulate');
    }
  });

  it('phrasing variation operates within a block (cannot fragment)', () => {
    // alternativePhrasing replaces canonical phrases per-block via block.replace,
    // so it can never move a line across a block boundary. Verify the contract
    // span is still contiguous with phrasing ON.
    const varied = varySystemPrompt(buildSyntheticPrompt(), {
      seed: 3,
      shuffleOrder: true,
      alternativePhrasing: true,
      variationRate: 1,
    });
    expect(varied).toContain(WHEN_TO_PLAN_SPAN);
  });
});
