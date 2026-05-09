/**
 * Tests for the agent dry-run path in `hooks-bridge.ts:test()`.
 * `dryRunSubAgent` is mocked so the test never spawns a real
 * pi-coding-agent session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HooksBridge, type UserHookHandler } from '../src/main/hooks/hooks-bridge';

const mkBridge = () => {
  const b = new HooksBridge();
  (b as unknown as { workspaceDir: string }).workspaceDir = '/tmp';
  return b;
};

describe('HooksBridge / agent dry-run', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports completion status + result on success', async () => {
    vi.doMock('../src/main/agent/sub-agent-bridge', () => ({
      dryRunSubAgent: vi.fn(async () => ({
        status: 'completed' as const,
        nickname: 'researcher-1',
        result: 'Research summary',
        durationMs: 240,
      })),
    }));
    const { HooksBridge: HB } = await import('../src/main/hooks/hooks-bridge');
    const b = new HB();
    (b as unknown as { workspaceDir: string }).workspaceDir = '/tmp';

    const handler: UserHookHandler = {
      type: 'agent',
      agent: { prompt: 'Find bugs in src/', role: 'researcher' },
    };
    const result = await b.test(handler);
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('Research summary');
    expect(result.durationMs).toBe(240);
  });

  it('marks empty prompt as failure (no agent spawn)', async () => {
    const handler: UserHookHandler = {
      type: 'agent',
      agent: { prompt: '' },
    };
    const result = await mkBridge().test(handler);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Empty agent.prompt');
  });

  it('reports failure when the agent errors out', async () => {
    vi.doMock('../src/main/agent/sub-agent-bridge', () => ({
      dryRunSubAgent: vi.fn(async () => ({
        status: 'error' as const,
        nickname: '?',
        error: 'Multi-agent system unavailable',
        durationMs: 12,
      })),
    }));
    const { HooksBridge: HB } = await import('../src/main/hooks/hooks-bridge');
    const b = new HB();
    (b as unknown as { workspaceDir: string }).workspaceDir = '/tmp';

    const result = await b.test({ type: 'agent', agent: { prompt: 'hi' } });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Multi-agent system unavailable');
  });
});
