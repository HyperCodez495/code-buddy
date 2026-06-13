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
    public path = '/tmp/mock-session-memory-preview-config-store.json';

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
    get: (key: string) => {
      if (key === 'memoryStrategy') return 'rolling';
      if (key === 'model') return 'gpt-5.5';
      return undefined;
    },
    getAll: () => ({ memoryStrategy: 'rolling', model: 'gpt-5.5' }),
  },
}));

import { SessionManager } from '../src/main/session/session-manager';

function makeDb(): DatabaseInstance {
  const sessionRow = {
    id: 's1',
    title: 'Preview me',
    claude_session_id: null,
    openai_thread_id: null,
    status: 'idle',
    cwd: '/tmp/work',
    mounted_paths: '[]',
    allowed_tools: '[]',
    memory_enabled: 1,
    model: 'gpt-5.5',
    project_id: 'project-1',
    is_background: 0,
    execution_mode: null,
    pinned: 0,
    archived: 0,
    tags: '[]',
    source: 'cowork',
    created_at: 1,
    updated_at: 2,
  };

  return {
    sessions: {
      create: vi.fn(),
      get: vi.fn(() => sessionRow),
      getAll: vi.fn(() => [sessionRow]),
      update: vi.fn(),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn(),
      getBySessionId: vi.fn(() => [
        {
          id: 'm1',
          session_id: 's1',
          role: 'user',
          content: JSON.stringify([{ type: 'text', text: 'We should always use stable anchors.' }]),
          timestamp: 1,
          token_usage: null,
          execution_time_ms: null,
          metadata: null,
        },
      ]),
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

describe('SessionManager memory preview', () => {
  it('exposes a session-level preview of automated memory sources', () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    manager.setProjectServices(
      {
        getActiveId: () => null,
        get: () => ({
          id: 'project-1',
          name: 'Project 1',
          workspacePath: '/tmp/project-1',
          memoryConfig: { memoryStrategy: 'rolling' },
        }),
      },
      {
        loadProjectContext: vi.fn(async () => '<project_memory />'),
        consolidateSessionMemory: vi.fn(async () => null),
        previewProjectMemory: vi.fn((_projectId: string, _sessionId: string) => ({
          projectId: 'project-1',
          candidateCount: 1,
          candidates: [
            {
              category: 'preference',
              content: 'Always use stable anchors.',
              sourceSessionId: 's1',
              sourceKind: 'user',
              evidence: 'We should always use stable anchors.',
            },
          ],
          hasWorkspace: true,
          projectMemoryPath: '/tmp/project-1/.codebuddy/memory',
        })),
      } as never
    );

    const preview = manager.getMemoryPreview('s1');

    expect(preview?.memoryStrategy).toBe('rolling');
    expect(preview?.automatedMemoryEnabled).toBe(true);
    expect(preview?.projectMemoryAvailable).toBe(true);
    expect(preview?.candidateCount).toBe(1);
    expect(preview?.candidates[0]?.category).toBe('preference');
  });
});
