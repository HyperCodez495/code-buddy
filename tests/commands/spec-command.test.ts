/**
 * Tests for `buddy spec ...` CLI (BMAD-inspired pipeline foundation).
 *
 * Exercises the real SpecStore against a temp workDir (process.cwd spied) so
 * the review-gate flow is verified end to end through the command wiring.
 */

import { Command } from 'commander';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { createSpecCommand } from '../../src/commands/spec.js';
import { resetSpecStores } from '../../src/spec/spec-store.js';

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.addCommand(createSpecCommand());
  return program;
}

function logText(spy: jest.SpyInstance): string {
  return (spy.mock.calls as unknown[][]).map((c) => c.join(' ')).join('\n');
}

describe('buddy spec', () => {
  let tmpDir: string;
  let cwdSpy: jest.SpyInstance;
  let consoleSpy: jest.SpyInstance;
  let consoleErrSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-cli-'));
    resetSpecStores();
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(
      (() => {}) as unknown as (code?: number | string | null) => never,
    );
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    processExitSpy.mockRestore();
    resetSpecStores();
    await fs.remove(tmpDir);
  });

  async function initProject(program: Command): Promise<void> {
    await program.parseAsync(['node', 'buddy', 'spec', 'init', 'Radar', 'map', 'app']);
  }

  async function addStory(program: Command, title: string): Promise<string> {
    consoleSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'spec', 'story', 'add', title, '-c', 'criterion one']);
    const id = logText(consoleSpy).match(/\[(st-[a-z0-9]+)\]/)?.[1];
    if (!id) throw new Error('no story id parsed');
    return id;
  }

  it('init creates a project and persists it', async () => {
    const program = createProgram();
    await initProject(program);
    expect(logText(consoleSpy)).toMatch(/Created spec project \[sp-/);
    expect(await fs.pathExists(path.join(tmpDir, '.codebuddy', 'specs'))).toBe(true);
  });

  it('errors when adding a story with no active project', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'buddy', 'spec', 'story', 'add', 'orphan']);
    expect(logText(consoleErrSpy)).toMatch(/no active spec project/i);
  });

  it('runs the full review-gated lifecycle: add → approve → start → complete', async () => {
    const program = createProgram();
    await initProject(program);
    const id = await addStory(program, 'Render radars');

    // draft initially
    consoleSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'spec', 'status']);
    expect(logText(consoleSpy)).toMatch(/draft 1/);

    consoleSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'spec', 'story', 'approve', id, '--by', 'Patrice']);
    expect(logText(consoleSpy)).toMatch(/APPROVED/);

    consoleSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'spec', 'story', 'start', id]);
    expect(logText(consoleSpy)).toMatch(/IN_PROGRESS/);

    consoleSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'spec', 'story', 'complete', id, '--evidence', 'tests green']);
    expect(logText(consoleSpy)).toMatch(/DONE/);
  });

  it('rejects an illegal transition (complete a draft story)', async () => {
    const program = createProgram();
    await initProject(program);
    const id = await addStory(program, 'Premature');
    consoleErrSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'spec', 'story', 'complete', id, '--evidence', 'x']);
    expect(logText(consoleErrSpy)).toMatch(/illegal transition/i);
  });

  it('approve without --by is rejected and writes nothing', async () => {
    const program = createProgram();
    await initProject(program);
    const id = await addStory(program, 'Needs reviewer');
    try {
      await program.parseAsync(['node', 'buddy', 'spec', 'story', 'approve', id]);
    } catch {
      /* commander rejects missing required option */
    }
    consoleSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'spec', 'story', 'show', id, '--json']);
    expect(JSON.parse(logText(consoleSpy)).status).toBe('draft');
  });
});
