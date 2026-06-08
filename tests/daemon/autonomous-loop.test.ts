import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetColabStore } from '../../src/fleet/colab-store';
import { FleetAutonomousLoop, type TaskExecutor } from '../../src/daemon/autonomous-loop';
import type { ModelTierConfig } from '../../src/agent/model-tier';

const TIER: ModelTierConfig = {
  localModel: 'qwen2.5:7b-instruct',
  localBaseUrl: 'http://localhost:11434/v1',
  escalationModel: 'claude-opus-4-8',
};

describe('FleetAutonomousLoop', () => {
  let dir: string;
  let store: FleetColabStore;

  function seedTasks(tasks: unknown[]): void {
    writeFileSync(join(dir, 'colab-tasks.json'), JSON.stringify({ version: '0.1', tasks }, null, 2));
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'auto-loop-'));
    store = new FleetColabStore({ dir, agentId: 'ministar-linux/code-buddy', now: () => 1_000, generateId: (p) => `${p}-x` });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeLoop(executor: TaskExecutor, enabled = true): FleetAutonomousLoop {
    return new FleetAutonomousLoop({ store, tierConfig: TIER, executor, enabled: () => enabled });
  }

  it('is a no-op when the kill-switch is off', async () => {
    seedTasks([{ id: 't1', title: 'task', status: 'open', priority: 'high', claimedBy: null }]);
    const executor = vi.fn();
    const result = await makeLoop(executor as unknown as TaskExecutor, false).tick();
    expect(result.outcome).toBe('disabled');
    expect(executor).not.toHaveBeenCalled();
    expect(store.getTask('t1')?.status).toBe('open');
  });

  it('goes idle when there is no claimable task', async () => {
    seedTasks([]);
    const result = await makeLoop(async () => ({ ok: true, summary: 'n/a' })).tick();
    expect(result.outcome).toBe('idle');
    expect(store.listPresence()['ministar-linux/code-buddy']?.status).toBe('idle');
  });

  it('never auto-claims a critical task (guardrail)', async () => {
    seedTasks([{ id: 'crit', title: 'danger', status: 'open', priority: 'critical', claimedBy: null }]);
    const executor = vi.fn();
    const result = await makeLoop(executor as unknown as TaskExecutor).tick();
    expect(result.outcome).toBe('idle');
    expect(executor).not.toHaveBeenCalled();
    expect(store.getTask('crit')?.status).toBe('open');
  });

  it('claims, runs on the local tier, completes, and logs on success', async () => {
    seedTasks([{ id: 't1', title: 'write haiku', status: 'open', priority: 'low', claimedBy: null }]);
    const executor: TaskExecutor = async (task, model) => {
      expect(model.tier).toBe('local');
      expect(model.paid).toBe(false);
      expect(model.model).toBe('qwen2.5:7b-instruct');
      return { ok: true, summary: `did ${task.title}`, filesModified: [{ file: 'out.md', changes: 'wrote haiku' }], elapsedSeconds: 3 };
    };
    const result = await makeLoop(executor).tick();
    expect(result.outcome).toBe('completed');
    expect(result.taskId).toBe('t1');
    expect(store.getTask('t1')?.status).toBe('completed');
    const log = store.listWorklog();
    expect(log).toHaveLength(1);
    expect(log[0]?.summary).toBe('did write haiku');
  });

  it('releases the task and logs the failure when the executor reports !ok', async () => {
    seedTasks([{ id: 't1', title: 'task', status: 'open', priority: 'medium', claimedBy: null }]);
    const result = await makeLoop(async () => ({ ok: false, summary: 'model unreachable', error: 'ECONNREFUSED' })).tick();
    expect(result.outcome).toBe('failed');
    expect(result.detail).toBe('ECONNREFUSED');
    // released back to the open pool so another tick/agent can retry
    expect(store.getTask('t1')?.status).toBe('open');
    expect(store.getTask('t1')?.claimedBy).toBeNull();
    expect(store.listWorklog()[0]?.issues).toContain('ECONNREFUSED');
  });

  it('treats an executor that throws as a failure (loop never crashes)', async () => {
    seedTasks([{ id: 't1', title: 'task', status: 'open', priority: 'low', claimedBy: null }]);
    const result = await makeLoop(async () => { throw new Error('boom'); }).tick();
    expect(result.outcome).toBe('failed');
    expect(store.getTask('t1')?.status).toBe('open');
  });
});
