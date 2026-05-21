import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRow } from '../src/main/db/database';

const databaseSourcePath = path.resolve(process.cwd(), 'src/main/db/database.ts');
const require = createRequire(import.meta.url);

let hasBetterSqlite3 = false;
let betterSqlite3Module: unknown = null;
function probeBetterSqlite(modulePath: string): unknown {
  const candidate = require(modulePath) as {
    new (dbPath: string): { close: () => void };
  };
  const probe = new candidate(':memory:');
  probe.close();
  return candidate;
}

try {
  try {
    betterSqlite3Module = probeBetterSqlite('better-sqlite3');
  } catch {
    betterSqlite3Module = probeBetterSqlite(
      path.resolve(process.cwd(), '..', 'node_modules', 'better-sqlite3'),
    );
  }
  hasBetterSqlite3 = true;
} catch {
  hasBetterSqlite3 = false;
}

let testRoot = '';

function mockElectron(userDataPath: string): void {
  vi.doMock('electron', () => ({
    app: {
      getPath: (name: string) => {
        if (name === 'userData') return userDataPath;
        if (name === 'home') return userDataPath;
        return userDataPath;
      },
      getVersion: () => '0.0.0-test',
    },
  }));
}

function mockLogger(): void {
  vi.doMock('../src/main/utils/logger', () => ({
    log: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
  }));
}

function mockBetterSqlite(): void {
  if (!betterSqlite3Module) return;
  vi.doMock('better-sqlite3', () => ({
    default: betterSqlite3Module,
  }));
}

async function loadDatabaseModule(userDataPath: string) {
  vi.resetModules();
  mockElectron(userDataPath);
  mockLogger();
  mockBetterSqlite();
  return import('../src/main/db/database');
}

function sessionRow(id: string, title: string): SessionRow {
  const now = Date.UTC(2026, 4, 16, 18, 0);
  return {
    id,
    title,
    claude_session_id: null,
    openai_thread_id: null,
    status: 'idle',
    cwd: 'D:/CascadeProjects/grok-cli-weekend',
    mounted_paths: '[]',
    allowed_tools: '[]',
    memory_enabled: 1,
    model: 'test-model',
    project_id: 'project-1',
    is_background: 0,
    execution_mode: 'chat',
    created_at: now,
    updated_at: now,
  };
}

describe('Cowork database message search', () => {
  afterEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock('electron');

    if (testRoot) {
      fs.rmSync(testRoot, { recursive: true, force: true });
      testRoot = '';
    }
  });

  it('maintains an FTS5 index for cross-session message search', () => {
    const source = fs.readFileSync(databaseSourcePath, 'utf8');

    expect(source).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5');
    expect(source).toContain('CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages');
    expect(source).toContain('CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages');
    expect(source).toContain('CREATE TRIGGER IF NOT EXISTS messages_au');
    expect(source).toContain('ORDER BY bm25(messages_fts), m.timestamp DESC');
  });

  it('keeps the LIKE fallback literal for wildcard-only searches', () => {
    const source = fs.readFileSync(databaseSourcePath, 'utf8');

    expect(source).toContain('function escapeLikePattern');
    expect(source).toContain("value.replace(/[\\\\%_]/g");
    expect(
      source.split('\n').some((line) => line.includes('LIKE LOWER(?)') && line.includes('ESCAPE'))
    ).toBe(true);
    expect(source).toContain('const ftsQuery = buildMessageFtsQuery(trimmed)');
  });

  describe.skipIf(!hasBetterSqlite3)('integration', () => {
    it('searches messages across sessions with session metadata attached', async () => {
      testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-message-search-'));
      const databaseModule = await loadDatabaseModule(testRoot);
      const db = databaseModule.initDatabase();
      const now = Date.UTC(2026, 4, 16, 19, 0);

      db.sessions.create(sessionRow('session-1', 'Fleet banana review'));
      db.sessions.create(sessionRow('session-2', 'Other session'));
      db.messages.create({
        id: 'message-1',
        session_id: 'session-1',
        role: 'assistant',
        content: JSON.stringify([{ type: 'text', text: 'BANANA routing summary' }]),
        timestamp: now,
        token_usage: null,
        execution_time_ms: null,
      });
      db.messages.create({
        id: 'message-2',
        session_id: 'session-2',
        role: 'user',
        content: JSON.stringify([{ type: 'text', text: 'unrelated text' }]),
        timestamp: now + 1,
        token_usage: null,
        execution_time_ms: null,
      });

      const hits = db.messages.searchContent('banana', 10);

      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({
        message_id: 'message-1',
        session_id: 'session-1',
        role: 'assistant',
        session_title: 'Fleet banana review',
        project_id: 'project-1',
      });

      databaseModule.closeDatabase();
    });

    it('treats LIKE wildcard characters as literal fallback queries', async () => {
      testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-message-search-'));
      const databaseModule = await loadDatabaseModule(testRoot);
      const db = databaseModule.initDatabase();
      const now = Date.UTC(2026, 4, 16, 19, 0);

      db.sessions.create(sessionRow('session-1', 'Literal wildcard'));
      db.sessions.create(sessionRow('session-2', 'Plain message'));
      db.messages.create({
        id: 'message-1',
        session_id: 'session-1',
        role: 'assistant',
        content: JSON.stringify([{ type: 'text', text: 'progress is 100% complete' }]),
        timestamp: now,
        token_usage: null,
        execution_time_ms: null,
      });
      db.messages.create({
        id: 'message-2',
        session_id: 'session-2',
        role: 'assistant',
        content: JSON.stringify([{ type: 'text', text: 'plain message without symbol' }]),
        timestamp: now + 1,
        token_usage: null,
        execution_time_ms: null,
      });

      const hits = db.messages.searchContent('%', 10);

      expect(hits.map((hit) => hit.message_id)).toEqual(['message-1']);

      databaseModule.closeDatabase();
    });
  });
});
