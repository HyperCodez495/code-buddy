import { describe, it, expect } from 'vitest';
import { extractBaseCommand } from '../../src/tools/bash/command-validator.js';
import { rewriteCommandWithRtk } from '../../src/tools/bash/rtk-rewrite.js';

/**
 * Regression: a weaker model can emit a `bash` tool call with no `command`
 * (or a non-string one). That used to crash the streaming bash path on
 * `command.trim()` ("Cannot read properties of undefined (reading 'trim')").
 * Both entry points must now degrade gracefully instead of throwing.
 */
describe('bash command guards — malformed / missing command', () => {
  it('extractBaseCommand returns null for a non-string command (no throw)', () => {
    expect(extractBaseCommand(undefined as unknown as string)).toBeNull();
    expect(extractBaseCommand(null as unknown as string)).toBeNull();
    expect(extractBaseCommand(123 as unknown as string)).toBeNull();
    expect(extractBaseCommand('   ')).toBeNull();
  });

  it('rewriteCommandWithRtk does not throw on a non-string command', async () => {
    const res = await rewriteCommandWithRtk(undefined as unknown as string);
    expect(res.rewritten).toBe(false);
    expect(res.reason).toBe('invalid-command');
  });
});
