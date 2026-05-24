import { describe, expect, it, vi } from 'vitest';
import { GlobalSearchService } from '../src/main/search/global-search-service';
import type { DatabaseInstance } from '../src/main/db/database';

type PreparedCall = {
  sql: string;
  args: unknown[];
};

function makeService(
  calls: PreparedCall[],
  messageContent = JSON.stringify([
    { type: 'text', text: 'The progress marker is 100% complete' },
  ]),
): GlobalSearchService {
  return new GlobalSearchService({
    db: {
      raw: {
        prepare: vi.fn((sql: string) => ({
          all: (...args: unknown[]) => {
            calls.push({ sql, args });
            if (sql.includes('FROM sessions')) {
              return [
                {
                  id: 'session-1',
                  title: 'Progress 100% review',
                  cwd: 'D:/CascadeProjects/grok-cli-weekend',
                  created_at: 1,
                },
              ];
            }
            if (sql.includes('FROM messages')) {
              return [
                {
                  id: 'message-1',
                  session_id: 'session-1',
                  content: messageContent,
                  timestamp: 2,
                  snippet: 'stale token',
                },
              ];
            }
            return [];
          },
        })),
      },
    } as DatabaseInstance,
  });
}

describe('GlobalSearchService', () => {
  it('treats SQL wildcard characters as literal in session and message searches', async () => {
    const calls: PreparedCall[] = [];
    const service = makeService(calls);

    const results = await service.search('%', 10);

    const likeCalls = calls.filter((call) => call.sql.includes('LIKE ?'));
    expect(likeCalls).toHaveLength(2);
    expect(likeCalls.every((call) => call.sql.includes("ESCAPE '\\'"))).toBe(true);
    expect(likeCalls.map((call) => call.args[0])).toEqual(['%\\%%', '%\\%%']);
    expect(results.hits.map((hit) => hit.source)).toContain('session');
    expect(results.hits).toContainEqual(
      expect.objectContaining({
        source: 'message',
        context: { sessionId: 'session-1', messageId: 'message-1' },
      }),
    );
  });

  it('builds readable snippets from non-text message content blocks', async () => {
    const calls: PreparedCall[] = [];
    const service = makeService(
      calls,
      JSON.stringify([
        { type: 'thinking', thinking: 'Investigating auth bug deeply' },
        { type: 'tool_use', name: 'Read', input: { path: 'src/auth.ts' } },
        { type: 'tool_result', content: 'Authentication failed due to stale token cache' },
        { type: 'file_attachment', filename: 'incident-report.docx' },
      ]),
    );

    const results = await service.search('stale token', 10);
    const messageHit = results.hits.find((hit) => hit.source === 'message');

    expect(messageHit?.title).toContain('Investigating auth bug deeply');
    expect(messageHit?.snippet).toContain('stale token');
  });
});
