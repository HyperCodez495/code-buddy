/**
 * Phase 2 — verify SessionManager keeps the embedded engine's MCP
 * registry in sync with the Cowork-side mcpConfigStore. The engine
 * adapter is mocked; we just assert the expected `setMcpServers`
 * calls + payload translation.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DatabaseInstance } from '../src/main/db/database';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

let storeServers: Array<Record<string, unknown>> = [];

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    public store: Record<string, unknown>;
    public path = '/tmp/mock-mcp-engine-sync-config-store.json';

    constructor(options: { defaults?: Record<string, unknown> }) {
      this.store = { ...(options?.defaults || {}) };
    }
    get<K extends keyof T>(key: K, fallback?: unknown): T[K] {
      return (this.store[key as string] ?? fallback) as T[K];
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

// Stub the mcpConfigStore singleton to return a controlled list.
vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getServers: () => storeServers,
    getEnabledServers: () =>
      storeServers.filter((s) => (s as { enabled?: boolean }).enabled !== false),
  },
}));

vi.mock('../src/main/claude/agent-runner', () => ({
  ClaudeAgentRunner: class {
    run = vi.fn();
    cancel = vi.fn();
    invalidateMcpServersCache = vi.fn();
    invalidateSkillsSetup = vi.fn();
  },
}));

vi.mock('../src/main/mcp/mcp-manager', () => ({
  MCPManager: class {
    initializeServers = vi.fn(async () => undefined);
    getTools = vi.fn(() => []);
  },
}));

import { SessionManager, type EngineAdapterLike } from '../src/main/session/session-manager';

function makeMinimalDb(): DatabaseInstance {
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
      update: vi.fn(),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
      getBySessionId: vi.fn(() => []),
      searchContent: vi.fn(() => []),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
    },
  } as unknown as DatabaseInstance;
}

function makeMockEngine(): EngineAdapterLike & {
  setMcpServers: ReturnType<typeof vi.fn>;
} {
  return {
    runSession: vi.fn(async () => ({ content: '' })),
    cancel: vi.fn(),
    clearSession: vi.fn(),
    setMcpServers: vi.fn(async () => undefined),
  } as unknown as EngineAdapterLike & { setMcpServers: ReturnType<typeof vi.fn> };
}

describe('SessionManager — engine MCP sync', () => {
  beforeEach(() => {
    storeServers = [];
  });

  it('pushes enabled MCP servers to the engine adapter on initializeMCP', async () => {
    storeServers = [
      {
        id: 's1',
        name: 'NotionDocs',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@notion/mcp'],
        env: { TOKEN: 'xxx' },
        enabled: true,
      },
      {
        id: 's2',
        name: 'Disabled',
        type: 'stdio',
        command: 'echo',
        enabled: false,
      },
    ];

    const engine = makeMockEngine();
    const mgr = new SessionManager(makeMinimalDb(), vi.fn(), undefined, engine);

    // initializeMCP fires from the constructor. Wait one tick so the
    // promise chain resolves.
    await new Promise((r) => setImmediate(r));

    expect(engine.setMcpServers).toHaveBeenCalledTimes(1);
    const pushed = engine.setMcpServers.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(pushed).toHaveLength(1); // disabled excluded
    expect(pushed[0]).toMatchObject({
      name: 'NotionDocs',
      enabled: true,
      transport: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@notion/mcp'],
        env: { TOKEN: 'xxx' },
      },
    });
    void mgr;
  });

  it('translates streamable-http to streamable_http for the engine', async () => {
    storeServers = [
      {
        id: 'sh',
        name: 'StreamableSrv',
        type: 'streamable-http',
        url: 'https://mcp.example.com/api',
        headers: { 'X-Auth': 'k' },
        enabled: true,
      },
    ];
    const engine = makeMockEngine();
    new SessionManager(makeMinimalDb(), vi.fn(), undefined, engine);
    await new Promise((r) => setImmediate(r));
    const pushed = engine.setMcpServers.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect((pushed[0] as { transport: { type: string } }).transport.type).toBe('streamable_http');
  });

  it('re-pushes after invalidateMcpServersCache when servers change', async () => {
    storeServers = [
      { id: 's1', name: 'A', type: 'stdio', command: 'a', enabled: true },
    ];
    const engine = makeMockEngine();
    const mgr = new SessionManager(makeMinimalDb(), vi.fn(), undefined, engine);
    await new Promise((r) => setImmediate(r));
    expect(engine.setMcpServers).toHaveBeenCalledTimes(1);

    storeServers = [
      { id: 's1', name: 'A', type: 'stdio', command: 'a', enabled: true },
      { id: 's2', name: 'B', type: 'sse', url: 'https://b.example', enabled: true },
    ];
    mgr.invalidateMcpServersCache();
    await new Promise((r) => setImmediate(r));

    expect(engine.setMcpServers).toHaveBeenCalledTimes(2);
    const pushed = engine.setMcpServers.mock.calls[1][0] as Array<Record<string, unknown>>;
    expect(pushed).toHaveLength(2);
    expect((pushed[1] as { transport: { type: string } }).transport.type).toBe('sse');
  });

  it('skips silently when engine adapter does not expose setMcpServers', async () => {
    storeServers = [{ id: 's1', name: 'A', type: 'stdio', command: 'a', enabled: true }];
    // Adapter without setMcpServers (legacy bundle).
    const legacyEngine = {
      runSession: vi.fn(async () => ({ content: '' })),
      cancel: vi.fn(),
      clearSession: vi.fn(),
    } as unknown as EngineAdapterLike;
    expect(() =>
      new SessionManager(makeMinimalDb(), vi.fn(), undefined, legacyEngine)
    ).not.toThrow();
  });
});
