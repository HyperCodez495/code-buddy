/**
 * Session cwd must exist before the engine runs — regression test for the live
 * incident where an AI app generation targeting a fresh (not-yet-created)
 * folder silently wrote into the Electron process cwd and overwrote cowork's
 * own index.html. startSession now creates the requested cwd (recursive,
 * fail-open).
 */
import { existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseInstance } from '../src/main/db/database';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-session-manager-cwd-config-store.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...(options?.defaults || {}) };
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.store[key as string] as T[K];
    }

    set(key: string | Record<string, unknown>, value?: unknown): void {
      if (typeof key === 'string') {
        this.store[key] = value;
        return;
      }
      this.store = { ...this.store, ...key };
    }
  }
  return { default: MockStore };
});

vi.mock('../src/main/claude/agent-runner', () => ({
  ClaudeAgentRunner: class {
    run = vi.fn(async () => {});
    cancel = vi.fn();
    handleQuestionResponse = vi.fn();
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getEnabledServers: () => [],
  },
}));

vi.mock('../src/main/config/config-store', () => ({
  configStore: {
    get: (key: string) => (key === 'model' ? 'gpt-5.5' : undefined),
    getAll: () => ({ model: 'gpt-5.5' }),
  },
}));

import { SessionManager } from '../src/main/session/session-manager';

function makeDb(): DatabaseInstance {
  return {
    sessions: {
      create: vi.fn(),
      get: vi.fn(() => null),
      getAll: vi.fn(() => []),
      update: vi.fn(),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn(),
      getBySessionId: vi.fn(() => []),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
    },
  } as unknown as DatabaseInstance;
}

describe('SessionManager session cwd creation', () => {
  it('creates a missing cwd (recursive) when starting a session', async () => {
    const manager = new SessionManager(makeDb(), vi.fn());
    const cwd = join(tmpdir(), `sm-cwd-test-${process.pid}`, 'nested', 'app');
    rmSync(join(tmpdir(), `sm-cwd-test-${process.pid}`), { recursive: true, force: true });
    expect(existsSync(cwd)).toBe(false);

    const session = await manager.startSession('t', 'p', cwd);
    expect(session.cwd).toBe(cwd);
    expect(existsSync(cwd)).toBe(true);

    rmSync(join(tmpdir(), `sm-cwd-test-${process.pid}`), { recursive: true, force: true });
  });

  it('leaves an existing cwd untouched and tolerates no cwd at all', async () => {
    const manager = new SessionManager(makeDb(), vi.fn());
    const session = await manager.startSession('t', 'p', tmpdir());
    expect(session.cwd).toBe(tmpdir());

    // No cwd → no throw, old behavior preserved.
    await expect(manager.startSession('t2', 'p2')).resolves.toBeTruthy();
  });
});
