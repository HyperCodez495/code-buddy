import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CoworkToolAgent,
  type FormalToolRegistryLike,
} from '../src/main/workflows/cowork-tool-agent';

const mkRegistry = (
  impl: FormalToolRegistryLike['execute']
): FormalToolRegistryLike => ({
  execute: impl,
});

describe('CoworkToolAgent / runToolInvoke', () => {
  it('delegates to FormalToolRegistry.execute and returns shaped output on success', async () => {
    const registry = mkRegistry(async (name, input) => ({
      success: true,
      output: { stdout: `ran ${name} with ${JSON.stringify(input)}` },
      toolName: name,
      duration: 42,
    }));
    const agent = new CoworkToolAgent({
      registry,
      onApprovalRequired: () => {
        throw new Error('should not be called');
      },
    });

    const out = await agent.runToolInvoke({
      toolName: 'bash_run',
      toolInput: { command: 'echo hi' },
    });

    expect(out).toEqual({
      success: true,
      output: { stdout: 'ran bash_run with {"command":"echo hi"}' },
      toolName: 'bash_run',
      duration: 42,
    });
  });

  it('throws when the registry reports failure', async () => {
    const registry = mkRegistry(async (name) => ({
      success: false,
      error: 'permission denied',
      toolName: name,
      duration: 1,
    }));
    const agent = new CoworkToolAgent({
      registry,
      onApprovalRequired: () => undefined,
    });

    await expect(
      agent.runToolInvoke({ toolName: 'bash_run', toolInput: {} })
    ).rejects.toThrow('permission denied');
  });

  it('throws when toolName is missing', async () => {
    const agent = new CoworkToolAgent({
      registry: mkRegistry(async () => ({
        success: true,
        toolName: '',
        duration: 0,
      })),
      onApprovalRequired: () => undefined,
    });
    await expect(agent.runToolInvoke({ toolInput: {} })).rejects.toThrow(
      /missing string toolName/
    );
  });
});

describe('CoworkToolAgent / runApprovalWait', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves on approve', async () => {
    const requested: unknown[] = [];
    const agent = new CoworkToolAgent({
      registry: mkRegistry(async () => ({
        success: true,
        toolName: '',
        duration: 0,
      })),
      onApprovalRequired: (payload) => requested.push(payload),
    });

    const promise = agent.runApprovalWait(
      { stepId: 's1', message: 'ok?', timeoutMs: 60000 },
      'inst_123'
    );

    expect(requested).toHaveLength(1);
    expect(agent.pendingCount()).toBe(1);

    const matched = agent.resolveApproval('s1', true);
    expect(matched).toBe(true);

    await expect(promise).resolves.toEqual({ approved: true, stepId: 's1' });
    expect(agent.pendingCount()).toBe(0);
  });

  it('rejects on reject', async () => {
    const agent = new CoworkToolAgent({
      registry: mkRegistry(async () => ({
        success: true,
        toolName: '',
        duration: 0,
      })),
      onApprovalRequired: () => undefined,
    });

    const promise = agent.runApprovalWait(
      { stepId: 's2', message: 'ok?', timeoutMs: 60000 },
      'inst_456'
    );
    agent.resolveApproval('s2', false);

    await expect(promise).rejects.toThrow(/was rejected/);
  });

  it('rejects on timeout', async () => {
    const agent = new CoworkToolAgent({
      registry: mkRegistry(async () => ({
        success: true,
        toolName: '',
        duration: 0,
      })),
      onApprovalRequired: () => undefined,
    });

    const promise = agent.runApprovalWait(
      { stepId: 's3', message: 'ok?', timeoutMs: 5000 },
      'inst_999'
    );
    const settled = expect(promise).rejects.toThrow(/timed out/);
    vi.advanceTimersByTime(5001);
    await settled;
    expect(agent.pendingCount()).toBe(0);
  });

  it('cancelPending rejects active approvals scoped to a workflow', async () => {
    const agent = new CoworkToolAgent({
      registry: mkRegistry(async () => ({
        success: true,
        toolName: '',
        duration: 0,
      })),
      onApprovalRequired: () => undefined,
    });
    const p1 = agent.runApprovalWait(
      { stepId: 'a', message: '?', timeoutMs: 60000 },
      'instA'
    );
    const p2 = agent.runApprovalWait(
      { stepId: 'b', message: '?', timeoutMs: 60000 },
      'instB'
    );
    const e1 = expect(p1).rejects.toThrow(/cancelled/);
    agent.cancelPending('instA');
    await e1;
    // p2 should still be pending
    expect(agent.pendingCount()).toBe(1);
    agent.resolveApproval('b', true);
    await expect(p2).resolves.toMatchObject({ approved: true });
  });

  it('refuses approval_wait when stepId is missing', async () => {
    const agent = new CoworkToolAgent({
      registry: mkRegistry(async () => ({
        success: true,
        toolName: '',
        duration: 0,
      })),
      onApprovalRequired: () => undefined,
    });
    await expect(
      agent.runApprovalWait({ message: '?' }, 'inst')
    ).rejects.toThrow(/missing stepId/);
  });
});
