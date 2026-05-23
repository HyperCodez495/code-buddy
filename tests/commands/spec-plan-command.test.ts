/**
 * Tests for `buddy spec plan ...` — the BMAD-inspired phased, review-gated planner.
 *
 * The LLM is injected as a fake `SpecLlmProvider`, so the whole phase machine (prd →
 * architecture → sharding → implementation) is exercised against the real SpecStore in
 * a temp workDir, with no network.
 */

import { Command } from 'commander';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { createPlanCommand } from '../../src/commands/spec-plan.js';
import { getSpecStore, resetSpecStores } from '../../src/spec/spec-store.js';
import type { SpecLlmCall } from '../../src/spec/spec-planner.js';

const fakeLlm: SpecLlmCall = async (system) => {
  const s = system.toLowerCase();
  // Order matters: the sharding prompt also contains the word "architecture".
  if (s.includes('scrum master')) return shardingJson();
  if (s.includes('product requirements')) return '# PRD: Radar\n## Problem\nx';
  return '# Architecture: Radar\n## Components\ny';
};

function shardingJson(): string {
  return JSON.stringify({
    stories: [
      {
        title: 'Render radars',
        epicTitle: 'Map',
        narrative: 'render them',
        acceptanceCriteria: ['shows radars'],
        allowedPaths: ['src/radar'],
        verification: ['npm test'],
        riskLevel: 'low',
      },
      {
        title: 'Move the map',
        epicTitle: 'Map',
        narrative: 'pan/zoom',
        acceptanceCriteria: ['drag pans'],
        allowedPaths: ['src/map'],
        verification: ['npm test'],
        riskLevel: 'low',
      },
    ],
  });
};

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.addCommand(createPlanCommand(async () => fakeLlm));
  return program;
}

function logText(spy: jest.SpyInstance): string {
  return (spy.mock.calls as unknown[][]).map((c) => c.join(' ')).join('\n');
}

describe('buddy spec plan', () => {
  let tmpDir: string;
  let cwdSpy: jest.SpyInstance;
  let consoleSpy: jest.SpyInstance;
  let consoleErrSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-plan-'));
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

  async function start(program: Command, ...extra: string[]): Promise<string> {
    consoleSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'plan', 'start', 'build', 'a', 'radar', 'app', ...extra]);
    const id = logText(consoleSpy).match(/\[(sp-[a-z0-9]+)\]/)?.[1];
    if (!id) throw new Error('no project id parsed from start output');
    return id;
  }

  it('start drafts the PRD and leaves the project in phase=prd', async () => {
    const program = createProgram();
    const id = await start(program);
    const store = getSpecStore(tmpDir);
    expect(store.getProject(id)?.phase).toBe('prd');
    expect(store.readArtifact(id, 'prd')).toContain('# PRD: Radar');
    expect(logText(consoleSpy)).toMatch(/spec plan continue/);
  });

  it('continue walks prd → architecture → sharding → implementation with a gate each step', async () => {
    const program = createProgram();
    const id = await start(program);
    const store = getSpecStore(tmpDir);

    await program.parseAsync(['node', 'buddy', 'plan', 'continue', '--by', 'Patrice']);
    expect(store.getProject(id)?.phase).toBe('architecture');
    expect(store.readArtifact(id, 'architecture')).toContain('# Architecture: Radar');

    await program.parseAsync(['node', 'buddy', 'plan', 'continue', '--by', 'Patrice']);
    expect(store.getProject(id)?.phase).toBe('sharding');
    const stories = store.listStories(id);
    expect(stories.length).toBe(2);
    expect(stories.every((s) => s.status === 'draft')).toBe(true);
    expect(stories[0].allowedPaths?.length).toBeGreaterThan(0);
    expect(stories[0].verification).toContain('npm test');
    expect(store.listEpics(id).map((e) => e.title)).toEqual(['Map']); // grouped, de-duped

    await program.parseAsync(['node', 'buddy', 'plan', 'continue', '--by', 'Patrice']);
    expect(store.getProject(id)?.phase).toBe('implementation');

    // the per-phase approvals were recorded
    const approvals = store.getProject(id)?.planApprovals;
    expect(approvals?.prd?.by).toBe('Patrice');
    expect(approvals?.architecture?.by).toBe('Patrice');
  });

  it('--auto runs every phase in one shot (but still requires --by)', async () => {
    const program = createProgram();

    // missing --by is rejected
    await program.parseAsync(['node', 'buddy', 'plan', 'start', 'thing', '--auto']);
    expect(logText(consoleErrSpy)).toMatch(/requires --by/i);

    const id = await start(program, '--auto', '--by', 'Patrice');
    expect(getSpecStore(tmpDir).getProject(id)?.phase).toBe('implementation');
    expect(getSpecStore(tmpDir).listStories(id).length).toBe(2);
  });

  it('status reports phase, artifacts, and the next command', async () => {
    const program = createProgram();
    const id = await start(program);
    consoleSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'plan', 'status', '-p', id]);
    const out = logText(consoleSpy);
    expect(out).toMatch(/phase: prd/);
    expect(out).toMatch(/prd\.md:\s+present/);
    expect(out).toMatch(/architecture\.md:\s+missing/);
    expect(out).toMatch(/Next:.*continue/);
  });

  it('start with no goal fails cleanly', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'buddy', 'plan', 'start', '   ']);
    expect(logText(consoleErrSpy)).toMatch(/goal is required/i);
  });

  it('continue after completion is a no-op message, not a crash', async () => {
    const program = createProgram();
    const id = await start(program, '--auto', '--by', 'Patrice');
    consoleSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'plan', 'continue', '--by', 'Patrice', '-p', id]);
    expect(logText(consoleSpy)).toMatch(/already complete/i);
  });
});
