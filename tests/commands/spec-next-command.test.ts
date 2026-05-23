/**
 * Tests for `buddy spec next` — the autonomous-runner bridge (Commit 3).
 *
 * The 286KB runner is mocked, so these assert the *story lineage* the command owns:
 * approved → in_progress before the run, then done / blocked / stays-in_progress based
 * on the run's terminal status, plus a thrown run routing to BLOCKED (never stranded).
 */

import { vi } from 'vitest';

vi.mock('../../src/agent/autonomous/agentic-coding-runner.js', () => ({
  runAgenticCodingCell: vi.fn(),
  writeAgenticCodingRunReport: vi.fn(async () => '/tmp/report.json'),
  renderAgenticCodingRunReport: vi.fn(() => '[rendered report]'),
}));

import { Command } from 'commander';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { createNextCommand } from '../../src/commands/spec-next.js';
import { getSpecStore, resetSpecStores } from '../../src/spec/spec-store.js';
import type { SpecStoryStatus } from '../../src/spec/spec-store.js';
import * as runner from '../../src/agent/autonomous/agentic-coding-runner.js';

const mockedRun = runner.runAgenticCodingCell as unknown as ReturnType<typeof vi.fn>;

function report(status: string, extra: Record<string, unknown> = {}) {
  return { status, verification: [], blockedReasons: [], validationErrors: [], ...extra };
}

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.addCommand(createNextCommand());
  return program;
}

function logText(spy: jest.SpyInstance): string {
  return (spy.mock.calls as unknown[][]).map((c) => c.join(' ')).join('\n');
}

describe('buddy spec next', () => {
  let tmpDir: string;
  let cwdSpy: jest.SpyInstance;
  let consoleSpy: jest.SpyInstance;
  let consoleErrSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-next-'));
    resetSpecStores();
    mockedRun.mockReset();
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

  /** Seed a project with one approved, runner-ready story; returns ids. */
  function seedApproved(opts: { allowedPaths?: string[]; verification?: string[] } = {}) {
    const store = getSpecStore(tmpDir);
    const p = store.createProject('p');
    const s = store.addStory(p.id, {
      title: 'Render radars',
      narrative: 'webview layer',
      acceptanceCriteria: ['shows radars'],
      allowedPaths: opts.allowedPaths ?? ['src/radar'],
      verification: opts.verification ?? ['npm test'],
      riskLevel: 'low',
    });
    store.approveStory(p.id, s.id, 'Patrice');
    return { store, projectId: p.id, storyId: s.id };
  }

  function statusOf(projectId: string, storyId: string): SpecStoryStatus | undefined {
    return getSpecStore(tmpDir).getStory(projectId, storyId)?.status;
  }

  it('verified run drives the story to DONE with verification as evidence', async () => {
    const { projectId, storyId } = seedApproved();
    mockedRun.mockResolvedValueOnce(
      report('verified', { verification: [{ command: 'npm test', status: 'passed' }] }),
    );

    await createProgram().parseAsync(['node', 'buddy', 'next']);

    expect(mockedRun).toHaveBeenCalledTimes(1);
    expect(statusOf(projectId, storyId)).toBe('done');
    expect(getSpecStore(tmpDir).getStory(projectId, storyId)?.evidence).toContain('npm test');
    expect(getSpecStore(tmpDir).getStory(projectId, storyId)?.lineage?.runId).toMatch(/^spec-/);
  });

  it('verification_failed routes the story to BLOCKED with a reason', async () => {
    const { projectId, storyId } = seedApproved();
    mockedRun.mockResolvedValueOnce(
      report('verification_failed', {
        verification: [{ command: 'npm test', status: 'failed', reason: 'red' }],
      }),
    );

    await createProgram().parseAsync(['node', 'buddy', 'next']);

    const blocked = getSpecStore(tmpDir).getStory(projectId, storyId);
    expect(blocked?.status).toBe('blocked');
    expect(blocked?.blockedReason).toMatch(/npm test/);
    expect(blocked?.lineage?.runId).toMatch(/^spec-/); // lineage survives the block transition
  });

  it('a scaffold-only (ready) run leaves the story IN_PROGRESS with a next step', async () => {
    const { projectId, storyId } = seedApproved();
    mockedRun.mockResolvedValueOnce(report('ready'));

    await createProgram().parseAsync(['node', 'buddy', 'next']);

    expect(statusOf(projectId, storyId)).toBe('in_progress');
    expect(logText(consoleSpy)).toMatch(/--edit-proposal-file/);
  });

  it('a thrown run blocks the story (never stranded in_progress)', async () => {
    const { projectId, storyId } = seedApproved();
    mockedRun.mockRejectedValueOnce(new Error('provider exploded'));

    await createProgram().parseAsync(['node', 'buddy', 'next']);

    const blocked = getSpecStore(tmpDir).getStory(projectId, storyId);
    expect(blocked?.status).toBe('blocked');
    expect(blocked?.blockedReason).toMatch(/provider exploded/);
    expect(blocked?.lineage?.runId).toMatch(/^spec-/); // runId set before the run survives the block
  });

  it('refuses (without transition) when the contract cannot be built', async () => {
    const { projectId, storyId } = seedApproved({ allowedPaths: [], verification: [] });

    await createProgram().parseAsync(['node', 'buddy', 'next']);

    expect(mockedRun).not.toHaveBeenCalled();
    expect(statusOf(projectId, storyId)).toBe('approved'); // unchanged
    expect(logText(consoleErrSpy)).toMatch(/Cannot build a task contract/);
  });

  it('--dry-run prints the contract and does not transition or run', async () => {
    const { projectId, storyId } = seedApproved();

    await createProgram().parseAsync(['node', 'buddy', 'next', '--dry-run']);

    expect(mockedRun).not.toHaveBeenCalled();
    expect(statusOf(projectId, storyId)).toBe('approved');
    expect(logText(consoleSpy)).toMatch(/"repo"/);
  });

  it('picks the oldest approved story when --story is omitted', async () => {
    const store = getSpecStore(tmpDir);
    const p = store.createProject('p');
    const first = store.addStory(p.id, { title: 'first', acceptanceCriteria: ['a'], allowedPaths: ['src'], verification: ['npm test'] });
    const second = store.addStory(p.id, { title: 'second', acceptanceCriteria: ['b'], allowedPaths: ['src'], verification: ['npm test'] });
    store.approveStory(p.id, second.id, 'r');
    store.approveStory(p.id, first.id, 'r');
    mockedRun.mockResolvedValueOnce(report('ready'));

    await createProgram().parseAsync(['node', 'buddy', 'next', '-p', p.id]);

    // first has the smaller createdAt, so it is chosen
    expect(statusOf(p.id, first.id)).toBe('in_progress');
    expect(statusOf(p.id, second.id)).toBe('approved');
  });

  it('rejects a --story that is not approved', async () => {
    const store = getSpecStore(tmpDir);
    const p = store.createProject('p');
    const s = store.addStory(p.id, { title: 'draft one', acceptanceCriteria: ['a'], allowedPaths: ['src'], verification: ['npm test'] });

    await createProgram().parseAsync(['node', 'buddy', 'next', '-p', p.id, '--story', s.id]);

    expect(mockedRun).not.toHaveBeenCalled();
    expect(logText(consoleErrSpy)).toMatch(/not approved/);
  });
});
