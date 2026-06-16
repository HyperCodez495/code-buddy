/**
 * REAL (no-mock) test for the goal-judge tool-failure footer (A3).
 *
 * Mirrors Hermes' "file-mutation verifier footer": when tool actions FAIL during
 * a goal turn, the judge must see a prominent, non-bracketed failure line so it
 * cannot be fooled into a premature "done" by an assistant that narrates success.
 *
 * No mocks — exercises the real exported functions from the engine adapter with
 * real ToolResult-shaped inputs.
 */
import { describe, it, expect } from 'vitest';
import {
  buildToolFailureFooter,
  buildGoalJudgeResponse,
  truncateFailureDetail,
} from '../../src/desktop/codebuddy-engine-adapter.js';

describe('goal judge — tool failure footer', () => {
  it('builds a prominent, non-bracketed footer naming each failed tool', () => {
    const footer = buildToolFailureFooter(['write_file: EACCES', 'bash: exit code 1']);
    expect(footer).toContain('⚠️');
    expect(footer).toContain('2 tool action(s) failed');
    expect(footer).toContain('write_file');
    expect(footer).toContain('bash');
    // Must NOT be a `[tool:…]` line — the judge ignores bracketed metadata.
    expect(footer.startsWith('[tool:')).toBe(false);
  });

  it('returns empty string when no failures', () => {
    expect(buildToolFailureFooter([])).toBe('');
  });

  it('appends the failure footer AFTER content + evidence (most prominent)', () => {
    const out = buildGoalJudgeResponse(
      'Task looks complete.',
      ['[tool:write_file error]\nEACCES: permission denied'],
      ['write_file: EACCES: permission denied'],
    );
    expect(out).toContain('Task looks complete.');
    expect(out).toContain('⚠️');
    // footer is positioned after the assistant content
    expect(out.indexOf('⚠️')).toBeGreaterThan(out.indexOf('Task looks complete.'));
  });

  it('omits the footer entirely when no failures are passed', () => {
    const out = buildGoalJudgeResponse('All good', ['[tool:read_file success]\n…']);
    expect(out).not.toContain('⚠️');
    expect(out).toContain('All good');
  });

  it('captures a failure even with EMPTY output/error (the silent-failure hole)', () => {
    // Replicates the adapter push logic for a ToolResult {success:false, output:undefined, error:undefined}.
    const toolResult = { success: false, output: undefined, error: undefined } as {
      success: boolean;
      output?: string;
      error?: string;
    };
    const name = 'write_file';
    const finalOutput = toolResult.output || toolResult.error;
    const failures: string[] = [];
    if (!toolResult.success) {
      const detail = finalOutput ? `: ${truncateFailureDetail(String(finalOutput))}` : '';
      failures.push(`${name}${detail}`);
    }
    expect(failures).toEqual(['write_file']);
    expect(buildToolFailureFooter(failures)).toContain('write_file');
  });

  it('truncateFailureDetail caps and flattens long output', () => {
    const long = 'x'.repeat(500) + '\n\nmore';
    const t = truncateFailureDetail(long);
    expect(t.length).toBeLessThanOrEqual(160);
    expect(t).not.toContain('\n');
  });
});
