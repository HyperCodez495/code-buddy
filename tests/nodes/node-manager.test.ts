import { afterEach, describe, expect, it } from 'vitest';

import {
  NodeManager,
  type NodeInvocationRequest,
} from '../../src/nodes/index.js';

function pairedAndroid(manager: NodeManager) {
  const request = manager.requestPairing('android', 'Téléphone test');
  return manager.approvePairing(request.code);
}

afterEach(() => {
  NodeManager.resetInstance();
});

describe('NodeManager correlated invocations', () => {
  it('fails closed when no node transport is connected', async () => {
    const manager = new NodeManager();
    const node = pairedAndroid(manager);

    const result = await manager.invoke({ nodeId: node.id, capability: 'calendar.list' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No transport is connected');
  });

  it('waits for the correlated business result instead of returning dispatched', async () => {
    const manager = new NodeManager();
    const node = pairedAndroid(manager);
    manager.on('node:invoke', ({ invocation }: { invocation: NodeInvocationRequest }) => {
      queueMicrotask(() => manager.completeInvocation(node.id, invocation.id, {
        success: true,
        data: { answer: 42 },
      }));
    });

    const result = await manager.invoke({ nodeId: node.id, capability: 'calendar.list' });

    expect(result).toMatchObject({ success: true, data: { answer: 42 } });
    expect(result.data).not.toEqual(expect.objectContaining({ dispatched: true }));
    expect(manager.getPendingInvocationCount()).toBe(0);
  });

  it('rejects a response sent by a different node and times out cleanly', async () => {
    const manager = new NodeManager({ invocationTimeoutMs: 15 });
    const node = pairedAndroid(manager);
    const other = pairedAndroid(manager);
    manager.on('node:invoke', ({ invocation }: { invocation: NodeInvocationRequest }) => {
      expect(manager.completeInvocation(other.id, invocation.id, { success: true })).toBe(false);
    });

    const result = await manager.invoke({ nodeId: node.id, capability: 'calendar.list' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    expect(manager.getPendingInvocationCount()).toBe(0);
  });

  it('cancels pending work when the node goes offline', async () => {
    const manager = new NodeManager({ invocationTimeoutMs: 5_000 });
    const node = pairedAndroid(manager);
    manager.on('node:invoke', () => queueMicrotask(() => manager.markOffline(node.id)));

    const result = await manager.invoke({ nodeId: node.id, capability: 'calendar.list' });

    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('went offline');
  });
});

describe('NodeManager calendar.list contract', () => {
  it('normalizes, sorts, bounds and returns calendar events to the planner', async () => {
    const manager = new NodeManager();
    const node = pairedAndroid(manager);
    manager.on('node:invoke', ({ invocation }: { invocation: NodeInvocationRequest }) => {
      queueMicrotask(() => manager.completeInvocation(node.id, invocation.id, {
        success: true,
        data: {
          timezone: 'Europe/Paris',
          events: [
            {
              id: 'later',
              summary: 'Dîner',
              start: '2026-07-15T19:00:00+02:00',
              end: '2026-07-15T21:00:00+02:00',
            },
            {
              id: 'earlier',
              title: 'Courses',
              start: '2026-07-15T17:00:00+02:00',
              location: 'Marché',
            },
          ],
        },
      }));
    });

    const result = await manager.listCalendar(node.id, {
      timeMin: '2026-07-15T00:00:00+02:00',
      timeMax: '2026-07-16T00:00:00+02:00',
      limit: 10,
    });

    expect(result.success).toBe(true);
    expect(result.data?.timezone).toBe('Europe/Paris');
    expect(result.data?.events.map((event) => event.id)).toEqual(['earlier', 'later']);
    expect(result.data?.events[1]).toMatchObject({ title: 'Dîner', allDay: false });
  });

  it('rejects malformed calendar data rather than exposing it as a valid schedule', async () => {
    const manager = new NodeManager();
    const node = pairedAndroid(manager);
    manager.on('node:invoke', ({ invocation }: { invocation: NodeInvocationRequest }) => {
      queueMicrotask(() => manager.completeInvocation(node.id, invocation.id, {
        success: true,
        data: { events: [{ id: 'bad', title: 'Sans date', start: 'tomorrow' }] },
      }));
    });

    const result = await manager.listCalendar(node.id);

    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid start');
  });

  it('rejects ambiguous ranges before contacting the phone', async () => {
    const manager = new NodeManager();
    const node = pairedAndroid(manager);
    let invoked = false;
    manager.on('node:invoke', () => { invoked = true; });

    const result = await manager.listCalendar(node.id, { timeMin: '2026-07-15T12:00:00' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('explicit offset');
    expect(invoked).toBe(false);
  });
});
