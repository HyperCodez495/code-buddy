import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildGlobalSearchFocusedMessageTarget,
  groupGlobalSearchHits,
  type GlobalSearchHit,
} from '../src/renderer/components/global-search-helpers';

const globalSearchDialogPath = path.resolve(
  process.cwd(),
  'src/renderer/components/GlobalSearchDialog.tsx'
);
const preloadPath = path.resolve(process.cwd(), 'src/preload/index.ts');

function hit(overrides: Partial<GlobalSearchHit>): GlobalSearchHit {
  return {
    source: 'message',
    id: 'message-1',
    title: 'Message',
    snippet: 'snippet',
    score: 1,
    context: { sessionId: 'session-1', messageId: 'message-1' },
    ...overrides,
  };
}

describe('GlobalSearchDialog navigation helpers', () => {
  it('focuses the exact message when a global message search result is opened', () => {
    const source = fs.readFileSync(globalSearchDialogPath, 'utf8');
    const preloadSource = fs.readFileSync(preloadPath, 'utf8');

    expect(source).toContain('setFocusedMessageTarget');
    expect(source).toContain('buildGlobalSearchFocusedMessageTarget(hit)');
    expect(preloadSource).toContain('messageId?: string');
  });

  it('builds a focused message target only for message hits with ids', () => {
    expect(buildGlobalSearchFocusedMessageTarget(hit({}))).toEqual({
      sessionId: 'session-1',
      messageId: 'message-1',
    });
    expect(buildGlobalSearchFocusedMessageTarget(hit({ source: 'session' }))).toBeNull();
    expect(
      buildGlobalSearchFocusedMessageTarget(hit({ context: { sessionId: 'session-1' } }))
    ).toBeNull();
    expect(
      buildGlobalSearchFocusedMessageTarget(hit({ context: { messageId: 'message-1' } }))
    ).toBeNull();
  });

  it('groups hits without changing their source order within each category', () => {
    const groups = groupGlobalSearchHits([
      hit({ source: 'file', id: 'file-1' }),
      hit({ source: 'message', id: 'message-1' }),
      hit({ source: 'message', id: 'message-2' }),
      hit({ source: 'memory', id: 'memory-1' }),
    ]);

    expect(groups.file.map((item) => item.id)).toEqual(['file-1']);
    expect(groups.message.map((item) => item.id)).toEqual(['message-1', 'message-2']);
    expect(groups.memory.map((item) => item.id)).toEqual(['memory-1']);
    expect(groups.session).toEqual([]);
  });
});
