/**
 * MultiAgentSystem workflow persistence (Phase G) tests.
 *
 * Validates save/load/clear roundtrip + atomic write + corrupt-file
 * recovery + Map serialization (results array form).
 *
 * Tests use the real ~/.codebuddy/agents/current.json path. To avoid
 * clobbering a user's actual workflow state, the test backs up any
 * pre-existing file before running and restores it after.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  saveWorkflow,
  loadWorkflow,
  clearWorkflow,
  _persistencePathForTests,
  type PersistedWorkflow,
} from '../../../src/agent/multi-agent/workflow-persistence.js';

const persistPath = _persistencePathForTests();
const tmpPath = `${persistPath}.tmp`;
const backupPath = `${persistPath}.test-backup`;

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function backupExisting(): Promise<void> {
  if (await exists(persistPath)) {
    await fs.rename(persistPath, backupPath);
  }
}

async function restoreBackup(): Promise<void> {
  if (await exists(backupPath)) {
    await fs.rename(backupPath, persistPath);
  } else {
    // No backup → ensure no test residue
    if (await exists(persistPath)) await fs.unlink(persistPath);
  }
  if (await exists(tmpPath)) await fs.unlink(tmpPath);
}

function makeState(overrides: Partial<PersistedWorkflow> = {}): PersistedWorkflow {
  return {
    goal: 'test workflow',
    startedAt: '2026-05-02T16:00:00Z',
    strategy: 'hierarchical',
    status: 'running',
    plan: null,
    results: [],
    artifacts: [],
    timeline: [],
    errors: [],
    ...overrides,
  };
}

describe('workflow-persistence', () => {
  beforeEach(async () => {
    await backupExisting();
  });

  afterEach(async () => {
    await restoreBackup();
  });

  it('save -> load roundtrip preserves all fields', async () => {
    const original = makeState({
      results: [['task-1', { success: true, role: 'coder', taskId: 'task-1', output: 'done', artifacts: [], toolsUsed: ['view_file'], rounds: 2, duration: 100 }]],
      timeline: [{ timestamp: new Date('2026-05-02T16:00:01Z'), type: 'task_started', message: 'Started: task-1' }],
      summary: 'one task done',
    });

    await saveWorkflow(original);
    const loaded = await loadWorkflow();

    expect(loaded).not.toBeNull();
    expect(loaded!.goal).toBe(original.goal);
    expect(loaded!.strategy).toBe('hierarchical');
    expect(loaded!.status).toBe('running');
    expect(loaded!.results).toHaveLength(1);
    expect(loaded!.results[0][0]).toBe('task-1');
    expect(loaded!.results[0][1].role).toBe('coder');
    expect(loaded!.summary).toBe('one task done');
    expect(loaded!.timeline).toHaveLength(1);
    // timestamps come back as strings (JSON serialization) — this is
    // expected and OK; consumers should re-parse if needed.
    expect(typeof loaded!.timeline[0].timestamp).toBe('string');
  });

  it('atomic write: no .tmp file remains after successful save', async () => {
    await saveWorkflow(makeState());
    expect(await exists(tmpPath)).toBe(false);
    expect(await exists(persistPath)).toBe(true);
  });

  it('loadWorkflow returns null when file does not exist', async () => {
    if (await exists(persistPath)) await fs.unlink(persistPath);
    const loaded = await loadWorkflow();
    expect(loaded).toBeNull();
  });

  it('loadWorkflow returns null + does not throw on corrupt JSON', async () => {
    await fs.mkdir(path.dirname(persistPath), { recursive: true });
    await fs.writeFile(persistPath, '{ this is not valid json', 'utf8');
    const loaded = await loadWorkflow();
    expect(loaded).toBeNull();
  });

  it('clearWorkflow removes the persisted file', async () => {
    await saveWorkflow(makeState());
    expect(await exists(persistPath)).toBe(true);
    await clearWorkflow();
    expect(await exists(persistPath)).toBe(false);
  });

  it('clearWorkflow is a no-op when file absent', async () => {
    if (await exists(persistPath)) await fs.unlink(persistPath);
    await expect(clearWorkflow()).resolves.toBeUndefined();
  });

  it('save overwrites previous state atomically', async () => {
    await saveWorkflow(makeState({ goal: 'first goal' }));
    await saveWorkflow(makeState({ goal: 'second goal', status: 'completed' }));
    const loaded = await loadWorkflow();
    expect(loaded!.goal).toBe('second goal');
    expect(loaded!.status).toBe('completed');
  });

  it('persistence path lives under ~/.codebuddy/agents/', () => {
    expect(persistPath).toContain(path.join(os.homedir(), '.codebuddy', 'agents'));
    expect(persistPath).toMatch(/current\.json$/);
  });

  // Phase J — schema versioning + completedTaskIds migration

  it('save auto-stamps schemaVersion = v0.3 when caller omits it', async () => {
    await saveWorkflow(makeState());
    const loaded = await loadWorkflow();
    expect(loaded!.schemaVersion).toBe('v0.3');
  });

  it('save auto-derives completedTaskIds from results when caller omits it', async () => {
    await saveWorkflow(makeState({
      results: [
        ['task-a', { success: true, role: 'coder', taskId: 'task-a', output: '', artifacts: [], toolsUsed: [], rounds: 1, duration: 1 }],
        ['task-b', { success: true, role: 'reviewer', taskId: 'task-b', output: '', artifacts: [], toolsUsed: [], rounds: 1, duration: 1 }],
      ],
    }));
    const loaded = await loadWorkflow();
    expect(loaded!.completedTaskIds).toEqual(['task-a', 'task-b']);
  });

  it('load auto-migrates pre-v0.3 saves (no schemaVersion → v0.1 + derived completedTaskIds)', async () => {
    // Hand-write a v0.2-shape file (no schemaVersion, no completedTaskIds)
    await fs.mkdir(path.dirname(persistPath), { recursive: true });
    const v02 = {
      goal: 'old goal',
      startedAt: '2026-05-02T10:00:00Z',
      strategy: 'hierarchical',
      status: 'running',
      plan: null,
      results: [['t1', { success: true, role: 'coder' }]],
      artifacts: [],
      timeline: [],
      errors: [],
    };
    await fs.writeFile(persistPath, JSON.stringify(v02), 'utf8');

    const loaded = await loadWorkflow();
    expect(loaded!.schemaVersion).toBe('v0.1');
    expect(loaded!.completedTaskIds).toEqual(['t1']);
  });

  it('explicit schemaVersion + completedTaskIds in save are preserved', async () => {
    await saveWorkflow(makeState({
      schemaVersion: 'v0.3',
      completedTaskIds: ['custom-id-only'],
      results: [['actual-id', { success: true, role: 'coder', taskId: 'actual-id', output: '', artifacts: [], toolsUsed: [], rounds: 1, duration: 1 }]],
    }));
    const loaded = await loadWorkflow();
    expect(loaded!.completedTaskIds).toEqual(['custom-id-only']);
    expect(loaded!.schemaVersion).toBe('v0.3');
  });
});
