import { describe, it, expect, vi } from 'vitest';
import { MessageHistoryManager } from '@/agent/facades/message-history-manager.js';
import type { CodeBuddyMessage } from '@/codebuddy/client.js';

// Silence the logger spam from internal trim & repair calls.
vi.mock('@/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * Tests for MessageHistoryManager — establishes the first dedicated test
 * file for this facade (T6 backlog foundation) AND covers the new
 * `getComprehensiveHistory()` / `getCuratedHistory()` distinction added
 * to close the Gemini CLI audit recommendation #3.
 *
 * The transcript-repair logic itself is fully covered in
 * `tests/context/transcript-repair.test.ts`. These tests focus on the
 * facade integration (correct delegation, no mutation, no compression).
 */
describe('MessageHistoryManager', () => {
  describe('construction + basic operations', () => {
    it('constructs with default config (no override)', () => {
      const m = new MessageHistoryManager();
      expect(m.getStats()).toMatchObject({
        chatHistorySize: 0,
        messagesSize: 0,
        maxHistory: 1000,
        maxMessages: 1000,
      });
    });

    it('getMessages returns a defensive copy (mutation by caller is safe)', () => {
      const m = new MessageHistoryManager();
      m.addMessage({ role: 'user', content: 'hi' });
      const snapshot = m.getMessages();
      snapshot.push({ role: 'assistant', content: 'should not leak' });
      // Internal state untouched by caller mutation.
      expect(m.getMessages()).toHaveLength(1);
    });

    it('addMessage triggers internal trim and preserves the system message', () => {
      const m = new MessageHistoryManager({ maxMessagesSize: 3, maxHistorySize: 100 });
      // System message is preserved by the trim logic; add 5 user messages on top.
      m.addMessage({ role: 'system', content: 'sys' });
      for (let i = 0; i < 5; i++) {
        m.addMessage({ role: 'user', content: `msg-${i}` });
      }
      const out = m.getMessages();
      // Trim must have fired (we added 6 messages but the cap is small).
      expect(out.length).toBeLessThan(6);
      // System message survives the trim (always at index 0).
      expect(out[0]?.role).toBe('system');
      expect(out[0]?.content).toBe('sys');
    });
  });

  describe('getComprehensiveHistory', () => {
    it('returns the raw history exactly as stored, including orphan tool_results', () => {
      const m = new MessageHistoryManager();
      const orphan = {
        role: 'tool',
        tool_call_id: 'orphan-1',
        content: 'orphaned result',
      } as unknown as CodeBuddyMessage;
      m.addMessage({ role: 'user', content: 'hi' });
      m.addMessage(orphan);

      const comprehensive = m.getComprehensiveHistory();
      expect(comprehensive).toHaveLength(2);
      // The orphan is present — comprehensive does NOT curate.
      expect(comprehensive.some(msg => (msg as { tool_call_id?: string }).tool_call_id === 'orphan-1')).toBe(true);
    });

    it('returns a defensive copy (mutation by caller does not affect internal state)', () => {
      const m = new MessageHistoryManager();
      m.addMessage({ role: 'user', content: 'a' });
      m.addMessage({ role: 'assistant', content: 'b' });

      const snap = m.getComprehensiveHistory();
      snap.length = 0;
      expect(m.getComprehensiveHistory()).toHaveLength(2);
    });
  });

  describe('getCuratedHistory', () => {
    it('removes orphan tool_results when no matching tool_call exists', () => {
      const m = new MessageHistoryManager();
      m.addMessage({ role: 'user', content: 'hi' });
      m.addMessage({
        role: 'tool',
        tool_call_id: 'orphan-1',
        content: 'orphaned result',
      } as unknown as CodeBuddyMessage);
      m.addMessage({ role: 'assistant', content: 'ok' });

      const curated = m.getCuratedHistory();
      expect(curated).toHaveLength(2);
      expect(curated.every(msg => msg.role !== 'tool')).toBe(true);
    });

    it('injects synthetic results for tool_calls with no matching tool_result', () => {
      const m = new MessageHistoryManager();
      m.addMessage({ role: 'user', content: 'run a tool' });
      m.addMessage({
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tc-1', type: 'function', function: { name: 'bash', arguments: '{}' } },
          { id: 'tc-2', type: 'function', function: { name: 'view_file', arguments: '{}' } },
        ],
      } as unknown as CodeBuddyMessage);
      m.addMessage({
        role: 'tool',
        tool_call_id: 'tc-1',
        content: 'bash result',
      } as unknown as CodeBuddyMessage);
      // tc-2 result missing — repair must inject a synthetic stub.
      m.addMessage({ role: 'assistant', content: 'done' });

      const curated = m.getCuratedHistory();
      const synthetic = curated.find(
        msg => msg.role === 'tool' && (msg as { tool_call_id?: string }).tool_call_id === 'tc-2',
      );
      expect(synthetic).toBeDefined();
      expect(synthetic!.content).toBe('[result lost during compaction]');
    });

    it('returns identical content to comprehensive when history is already valid', () => {
      const m = new MessageHistoryManager();
      m.addMessage({ role: 'system', content: 'sys' });
      m.addMessage({ role: 'user', content: 'hi' });
      m.addMessage({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'tc-1', type: 'function', function: { name: 'bash', arguments: '{}' } }],
      } as unknown as CodeBuddyMessage);
      m.addMessage({
        role: 'tool',
        tool_call_id: 'tc-1',
        content: 'ok',
      } as unknown as CodeBuddyMessage);
      m.addMessage({ role: 'assistant', content: 'done' });

      expect(m.getCuratedHistory()).toEqual(m.getComprehensiveHistory());
    });

    it('does NOT mutate internal state when called', () => {
      const m = new MessageHistoryManager();
      m.addMessage({ role: 'user', content: 'hi' });
      m.addMessage({
        role: 'tool',
        tool_call_id: 'orphan-1',
        content: 'orphan',
      } as unknown as CodeBuddyMessage);

      const before = m.getComprehensiveHistory();
      m.getCuratedHistory(); // Discard result; just calling should not mutate.
      const after = m.getComprehensiveHistory();

      // The orphan must STILL be present in comprehensive after curation was requested.
      expect(after).toEqual(before);
      expect(after).toHaveLength(2);
    });
  });
});
