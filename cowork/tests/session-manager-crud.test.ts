import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
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
    public path = '/tmp/mock-session-manager-crud-config-store.json';

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
    run = vi.fn();
    cancel = vi.fn();
    handleQuestionResponse = vi.fn();
  },
}));

vi.mock('../src/main/mcp/mcp-config-store', () => ({
  mcpConfigStore: {
    getEnabledServers: () => [],
  },
}));

import {
  SessionManager,
  createUniqueAttachmentFilename,
  formatFileAttachmentPromptLine,
} from '../src/main/session/session-manager';

// Shared minimal DB factory used across tests
function makeDb(overrides: Partial<DatabaseInstance> = {}): DatabaseInstance {
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
    ...overrides,
  } as unknown as DatabaseInstance;
}

// ------------------------------------------------------------------
// listSessions
// ------------------------------------------------------------------
describe('SessionManager.listSessions', () => {
  it('returns empty array when database is empty', () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    expect(manager.listSessions()).toEqual([]);
    expect(db.sessions.getAll).toHaveBeenCalledTimes(1);
  });

  it('maps database rows to Session objects', () => {
    const row = {
      id: 's1',
      title: 'My Session',
      claude_session_id: null,
      openai_thread_id: null,
      status: 'idle',
      cwd: '/tmp/workspace',
      mounted_paths: JSON.stringify([{ virtual: '/mnt/workspace', real: '/tmp/workspace' }]),
      allowed_tools: JSON.stringify(['read', 'write']),
      memory_enabled: 0,
      model: 'claude-3-5-sonnet',
      project_id: 'project-1',
      is_background: 1,
      execution_mode: 'task',
      created_at: 1000,
      updated_at: 2000,
    };
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => null),
        getAll: vi.fn(() => [row]),
        update: vi.fn(),
        delete: vi.fn(),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const sessions = manager.listSessions();

    expect(sessions).toHaveLength(1);
    const s = sessions[0];
    expect(s.id).toBe('s1');
    expect(s.title).toBe('My Session');
    expect(s.cwd).toBe('/tmp/workspace');
    expect(s.mountedPaths).toEqual([{ virtual: '/mnt/workspace', real: '/tmp/workspace' }]);
    expect(s.allowedTools).toEqual(['read', 'write']);
    expect(s.memoryEnabled).toBe(false);
    expect(s.model).toBe('claude-3-5-sonnet');
    expect(s.projectId).toBe('project-1');
    expect(s.isBackground).toBe(true);
    expect(s.executionMode).toBe('task');
    expect(s.createdAt).toBe(1000);
    expect(s.updatedAt).toBe(2000);
  });

  it('falls back to empty arrays when mounted_paths or allowed_tools JSON is malformed', () => {
    const row = {
      id: 's2',
      title: 'Broken JSON',
      claude_session_id: null,
      openai_thread_id: null,
      status: 'idle',
      cwd: null,
      mounted_paths: '{{{broken',
      allowed_tools: '[unclosed',
      memory_enabled: 0,
      model: null,
      created_at: 1,
      updated_at: 1,
    };
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => null),
        getAll: vi.fn(() => [row]),
        update: vi.fn(),
        delete: vi.fn(),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const [s] = manager.listSessions();

    expect(s.mountedPaths).toEqual([]);
    expect(s.allowedTools).toEqual([]);
  });
});

// ------------------------------------------------------------------
// getMessages — content normalization
// ------------------------------------------------------------------
describe('SessionManager.getMessages content normalization', () => {
  it('parses a JSON array content correctly', () => {
    const db = makeDb({
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm1',
            session_id: 's1',
            role: 'user',
            content: JSON.stringify([{ type: 'text', text: 'hello' }]),
            timestamp: 1,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const messages = manager.getMessages('s1');

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('wraps a single JSON object content in an array', () => {
    const db = makeDb({
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm2',
            session_id: 's1',
            role: 'user',
            content: JSON.stringify({ type: 'text', text: 'single block' }),
            timestamp: 2,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const [msg] = manager.getMessages('s1');
    expect(msg.content).toEqual([{ type: 'text', text: 'single block' }]);
  });

  it('wraps a plain JSON string as a text content block', () => {
    const db = makeDb({
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm3',
            session_id: 's1',
            role: 'assistant',
            content: JSON.stringify('plain string content'),
            timestamp: 3,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const [msg] = manager.getMessages('s1');
    expect(msg.content).toEqual([{ type: 'text', text: 'plain string content' }]);
  });

  it('falls back to raw string as text block when JSON parse fails', () => {
    const db = makeDb({
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm4',
            session_id: 's1',
            role: 'assistant',
            content: 'not valid json {{{',
            timestamp: 4,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());
    const [msg] = manager.getMessages('s1');
    expect(msg.content).toEqual([{ type: 'text', text: 'not valid json {{{' }]);
  });
});

// ------------------------------------------------------------------
// handlePermissionResponse
// ------------------------------------------------------------------
describe('SessionManager.handlePermissionResponse', () => {
  it('resolves the pending permission promise with the given result', async () => {
    const db = makeDb();
    const sendToRenderer = vi.fn();
    const manager = new SessionManager(db, sendToRenderer);

    // Inject a fake pending permission via requestPermission
    const permissionPromise = manager.requestPermission('s1', 'tool-1', 'bash', { command: 'ls' });

    // Synchronously resolve it
    manager.handlePermissionResponse('tool-1', 'allow');

    const result = await permissionPromise;
    expect(result).toBe('allow');
  });

  it('is a no-op when the toolUseId is unknown', () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    // Should not throw
    expect(() => manager.handlePermissionResponse('nonexistent', 'deny')).not.toThrow();
  });
});

// ------------------------------------------------------------------
// handleSudoPasswordResponse
// ------------------------------------------------------------------
describe('SessionManager.handleSudoPasswordResponse', () => {
  it('resolves the pending sudo password promise with the given password', async () => {
    const db = makeDb();
    const sendToRenderer = vi.fn();
    const manager = new SessionManager(db, sendToRenderer);

    const sudoPromise = manager.requestSudoPassword('s1', 'tool-2', 'sudo apt-get update');

    manager.handleSudoPasswordResponse('tool-2', 'secret123');

    const password = await sudoPromise;
    expect(password).toBe('secret123');
  });

  it('is a no-op when the toolUseId is unknown', () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    expect(() => manager.handleSudoPasswordResponse('nonexistent', 'pw')).not.toThrow();
  });
});

// ------------------------------------------------------------------
// deleteSession — cache eviction
// ------------------------------------------------------------------
describe('SessionManager.deleteSession cache eviction', () => {
  it('evicts the message cache when a session is deleted', async () => {
    const db = makeDb({
      sessions: {
        create: vi.fn(),
        get: vi.fn(() => null),
        getAll: vi.fn(() => []),
        update: vi.fn(),
        delete: vi.fn(),
      } as any,
      messages: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => [
          {
            id: 'm1',
            session_id: 's1',
            role: 'user',
            content: JSON.stringify([{ type: 'text', text: 'hi' }]),
            timestamp: 1,
            token_usage: null,
            execution_time_ms: null,
          },
        ]),
      } as any,
    });

    const manager = new SessionManager(db, vi.fn());

    // Populate the cache
    manager.getMessages('s1');
    expect(db.messages.getBySessionId).toHaveBeenCalledTimes(1);

    // Delete the session (mocked: no real DB changes)
    await manager.deleteSession('s1');

    // Cache should have been evicted — DB should be hit again on next call
    manager.getMessages('s1');
    expect(db.messages.getBySessionId).toHaveBeenCalledTimes(2);
  });
});

// ------------------------------------------------------------------
// searchMessageContent — Phase 3 (cross-session search)
// ------------------------------------------------------------------
describe('SessionManager.searchMessageContent', () => {
  it('returns empty array for empty/whitespace queries without hitting the DB', () => {
    const searchContent = vi.fn(() => []);
    const db = makeDb({
      messages: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => []),
        searchContent,
      } as any,
    });
    const manager = new SessionManager(db, vi.fn());
    expect(manager.searchMessageContent('')).toEqual([]);
    expect(manager.searchMessageContent('   ')).toEqual([]);
    expect(searchContent).not.toHaveBeenCalled();
  });

  it('forwards the query and decorates hits with snippets centered on the match', () => {
    const searchContent = vi.fn(() => [
      {
        message_id: 'm1',
        session_id: 's1',
        role: 'user',
        content: JSON.stringify([
          { type: 'text', text: 'long preamble lorem ipsum BANANA dolor sit amet trailing copy' },
        ]),
        timestamp: 1234,
        session_title: 'My session',
        project_id: 'p1',
      },
    ]);
    const db = makeDb({
      messages: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => []),
        searchContent,
      } as any,
    });
    const manager = new SessionManager(db, vi.fn());

    const hits = manager.searchMessageContent('banana', 25);
    expect(searchContent).toHaveBeenCalledWith('banana', 25);
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('m1');
    expect(hits[0].sessionId).toBe('s1');
    expect(hits[0].sessionTitle).toBe('My session');
    expect(hits[0].snippet).toContain('BANANA');
    expect(hits[0].timestamp).toBe(1234);
    expect(hits[0].projectId).toBe('p1');
  });

  it('handles plain-string content (legacy rows) without throwing', () => {
    const searchContent = vi.fn(() => [
      {
        message_id: 'm2',
        session_id: 's2',
        role: 'assistant',
        content: 'plain text needle hidden in a haystack',
        timestamp: 0,
        session_title: 'legacy',
        project_id: null,
      },
    ]);
    const db = makeDb({
      messages: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteBySessionId: vi.fn(),
        getBySessionId: vi.fn(() => []),
        searchContent,
      } as any,
    });
    const manager = new SessionManager(db, vi.fn());

    const [hit] = manager.searchMessageContent('needle');
    expect(hit.snippet).toContain('needle');
    expect(hit.projectId).toBeNull();
  });
});

describe('formatFileAttachmentPromptLine', () => {
  it('includes MIME type context when available for document attachments', () => {
    expect(
      formatFileAttachmentPromptLine({
        filename: 'questions.docx',
        relativePath: '.tmp/questions.docx',
        size: 2048,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    ).toBe(
      '- questions.docx (2.0 KB, type: application/vnd.openxmlformats-officedocument.wordprocessingml.document) at path: .tmp/questions.docx'
    );
  });

  it('keeps the existing compact line when MIME type is unknown', () => {
    expect(
      formatFileAttachmentPromptLine({
        filename: 'notes.bin',
        relativePath: '.tmp/notes.bin',
        size: 512,
      })
    ).toBe('- notes.bin (0.5 KB) at path: .tmp/notes.bin');
  });
});

describe('createUniqueAttachmentFilename', () => {
  it('keeps duplicate attachment basenames from overwriting each other', () => {
    const used = new Set<string>();

    expect(createUniqueAttachmentFilename('questions.docx', used)).toBe('questions.docx');
    expect(createUniqueAttachmentFilename('questions.docx', used)).toBe('questions-2.docx');
    expect(
      createUniqueAttachmentFilename('questions.docx', used, (candidate) => candidate === 'questions-3.docx')
    ).toBe('questions-4.docx');
  });
});

describe('SessionManager file attachment processing', () => {
  it('copies duplicate attachment filenames to unique .tmp paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cowork-session-attachments-'));
    const firstDir = join(root, 'first');
    const secondDir = join(root, 'second');
    mkdirSync(firstDir);
    mkdirSync(secondDir);
    const firstSource = join(firstDir, 'questions.docx');
    const secondSource = join(secondDir, 'questions.docx');
    writeFileSync(firstSource, 'first');
    writeFileSync(secondSource, 'second');

    try {
      const manager = new SessionManager(makeDb(), vi.fn());
      const processed = await (manager as any).processFileAttachments(
        { id: 'session-attachments', cwd: root },
        [
          {
            type: 'file_attachment',
            filename: 'questions.docx',
            relativePath: firstSource,
            size: 5,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
          {
            type: 'file_attachment',
            filename: 'questions.docx',
            relativePath: secondSource,
            size: 6,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
        ]
      );

      expect(processed.map((block: any) => block.relativePath)).toEqual([
        join('.tmp', 'questions.docx'),
        join('.tmp', 'questions-2.docx'),
      ]);
      expect(readFileSync(join(root, '.tmp', 'questions.docx'), 'utf8')).toBe('first');
      expect(readFileSync(join(root, '.tmp', 'questions-2.docx'), 'utf8')).toBe('second');
      expect(existsSync(join(root, '.tmp', 'questions-3.docx'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('routes attachment-only Word documents through the workshop prompt', async () => {
    const db = makeDb();
    const manager = new SessionManager(db, vi.fn());
    const run = vi.fn(async () => undefined);
    (manager as any).agentRunner = { run, cancel: vi.fn() };
    (manager as any).ensureSandboxInitialized = vi.fn(async () => undefined);
    (manager as any).processFileAttachments = vi.fn(async (_session: unknown, content: unknown) => content);
    (manager as any).runSessionTitleGeneration = vi.fn(async () => undefined);

    await (manager as any).processPrompt(
      {
        id: 'session-word-workshop',
        title: 'Word workshop',
        status: 'idle',
        cwd: 'D:\\Workspace',
        mountedPaths: [],
        allowedTools: [],
        memoryEnabled: false,
        model: 'test-model',
        createdAt: 1,
        updatedAt: 1,
      },
      '',
      [
        {
          type: 'file_attachment',
          filename: 'questions.docx',
          relativePath: '.tmp/questions.docx',
          size: 2048,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      ]
    );

    expect(run).toHaveBeenCalledTimes(1);
    const enhancedPrompt = run.mock.calls[0][1] as string;
    expect(enhancedPrompt).toContain('Analyze the attached document(s): questions.docx');
    expect(enhancedPrompt).toContain('[Document workshop guidance]');
    expect(enhancedPrompt).toContain('[Document workshop path hints]');
    expect(enhancedPrompt).toContain('questions-livrable.docx');
  });
});
