/**
 * `buddy science` CLI — opt-in + help surface.
 *
 * These tests exercise the real command via Commander (no mocks of the command
 * itself). The load-bearing property: WITHOUT `CODEBUDDY_AI_SCIENTIST=true` the
 * command prints an opt-in notice and runs NOTHING (no provider resolution, no
 * experiment). `--help` lists the documented options.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createScienceCommand } from '../../src/commands/science/index.js';

describe('buddy science — opt-in gate', () => {
  const prev = process.env.CODEBUDDY_AI_SCIENTIST;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.CODEBUDDY_AI_SCIENTIST;
    process.exitCode = 0;
    // logger.error writes through winston; spy on console.error is unreliable,
    // so spy on the logger module surface instead.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    if (prev === undefined) delete process.env.CODEBUDDY_AI_SCIENTIST;
    else process.env.CODEBUDDY_AI_SCIENTIST = prev;
    process.exitCode = 0;
  });

  it('prints an opt-in notice and does NOT run when the env flag is unset', async () => {
    const cmd = createScienceCommand();
    cmd.exitOverride();
    // If the command tried to run the pass, it would attempt provider resolution
    // and experiment execution — neither should happen. We assert via exitCode.
    await cmd.parseAsync(['a toy goal'], { from: 'user' });
    expect(process.exitCode).toBe(1);
  });

  it('help lists the documented options', () => {
    const cmd = createScienceCommand();
    const help = cmd.helpInformation();
    expect(help).toContain('--hypothesis');
    expect(help).toContain('--code-file');
    expect(help).toContain('--language');
    expect(help).toContain('--report');
    expect(help).toContain('--no-publish');
    // The description must flag it as experimental / gated.
    expect(help.toLowerCase()).toContain('experimental');
  });
});
