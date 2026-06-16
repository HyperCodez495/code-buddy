/**
 * Unit test for the execution-discipline prompt block (added 2026-06-16 from
 * the Hermes Agent prompt audit). Pure function, no deps — deterministic.
 *
 * Integration / gating (present for simple+standard+complex, absent for
 * trivial/lite and tool-callless models) is covered end-to-end in
 * tests/services/prompt-builder-query-aware.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { getExecutionDisciplineBlock } from '../../src/prompts/execution-discipline.js';

describe('getExecutionDisciplineBlock()', () => {
  const block = getExecutionDisciplineBlock();

  it('has the section header used by the prompt-builder gate assertions', () => {
    expect(block).toContain('## Execution discipline');
  });

  it('encodes the anti-stub / working-artifact mandate', () => {
    expect(block).toMatch(/working artifact backed by real tool output/i);
    expect(block).toMatch(/do not stop after writing a stub/i);
  });

  it('encodes tool-persistence until verified', () => {
    expect(block).toMatch(/keep using tools until/i);
    expect(block).toMatch(/verified the result with a tool/i);
  });

  it('encodes mandatory-tool-use (no guessing/fabrication)', () => {
    expect(block).toMatch(/ALWAYS use a tool/);
    expect(block).toMatch(/never guess or fabricate/i);
  });

  it('encodes a pre-finalize self-check (correctness / grounding / scope)', () => {
    expect(block).toMatch(/Correctness/);
    expect(block).toMatch(/Grounding/);
    expect(block).toMatch(/Scope/);
  });

  it('stays compact (~12 lines) to preserve the token budget', () => {
    expect(block.split('\n').length).toBeLessThanOrEqual(14);
  });
});
