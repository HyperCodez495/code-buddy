import { describe, expect, it } from 'vitest';
import type { DatabaseInstance, ScheduledTaskRow } from '../src/main/db/database';
import { createScheduledTaskStore } from '../src/main/schedule/scheduled-task-store';

function createFakeDatabase(): DatabaseInstance {
  const rows = new Map<string, ScheduledTaskRow>();
  return {
    scheduledTasks: {
      create: (task: ScheduledTaskRow) => {
        rows.set(task.id, task);
      },
      update: (id: string, updates: Partial<ScheduledTaskRow>) => {
        const existing = rows.get(id);
        if (!existing) return;
        rows.set(id, { ...existing, ...updates });
      },
      get: (id: string) => rows.get(id),
      getAll: () => Array.from(rows.values()),
      delete: (id: string) => {
        rows.delete(id);
      },
    },
  } as unknown as DatabaseInstance;
}

describe('scheduled task store', () => {
  it('round-trips structured metadata through the SQLite row shape', () => {
    const store = createScheduledTaskStore(createFakeDatabase());
    const now = Date.UTC(2026, 4, 16, 18, 0);

    const created = store.create({
      title: 'Fleet dispatch',
      prompt: 'dispatch goal',
      cwd: 'D:/CascadeProjects/grok-cli-weekend',
      runAt: now,
      metadata: {
        source: 'fleet-command-center',
        dispatchProfile: 'review',
        privacyTag: 'sensitive',
        parallelism: 3,
        includeMemoryContext: true,
        memoryCount: 2,
      },
    });

    expect(created.metadata).toEqual({
      source: 'fleet-command-center',
      dispatchProfile: 'review',
      privacyTag: 'sensitive',
      parallelism: 3,
      includeMemoryContext: true,
      memoryCount: 2,
    });

    const reloaded = store.get(created.id);
    expect(reloaded?.metadata).toEqual(created.metadata);

    const cleared = store.update(created.id, { metadata: null });
    expect(cleared?.metadata).toBeNull();
  });
});
