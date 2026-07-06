/**
 * studio-chat-adapter — real test (no mocks): map session messages to the bolt.new
 * iterate-chat shape (text extraction, system filtered, running → streaming).
 */
import { describe, expect, it } from 'vitest';
import { sessionToStudioMessages } from '../src/renderer/components/studio/studio-chat-adapter';

describe('sessionToStudioMessages', () => {
  it('extracts text and keeps only user/assistant', () => {
    const out = sessionToStudioMessages([
      { id: '1', role: 'user', content: [{ type: 'text', text: 'make the button blue' }] },
      { id: '2', role: 'system', content: [{ type: 'text', text: 'system prompt' }] },
      { id: '3', role: 'assistant', content: [{ type: 'text', text: 'Done — ' }, { type: 'text', text: 'updated App.css' }] },
    ]);
    expect(out).toEqual([
      { id: '1', role: 'user', text: 'make the button blue' },
      { id: '3', role: 'assistant', text: 'Done — updated App.css' },
    ]);
  });

  it('drops messages with no visible text (tool-only turns)', () => {
    const out = sessionToStudioMessages([
      { id: '1', role: 'assistant', content: [{ type: 'tool_use', text: undefined }] },
      { id: '2', role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('2');
  });

  it('marks the last assistant bubble streaming while running', () => {
    const running = sessionToStudioMessages(
      [
        { id: '1', role: 'user', content: [{ type: 'text', text: 'go' }] },
        { id: '2', role: 'assistant', content: [{ type: 'text', text: 'working' }] },
      ],
      { running: true },
    );
    expect(running[1]!.streaming).toBe(true);

    // last message is the user's → nothing streams
    const userLast = sessionToStudioMessages(
      [{ id: '1', role: 'user', content: [{ type: 'text', text: 'go' }] }],
      { running: true },
    );
    expect(userLast[0]!.streaming).toBeUndefined();
  });
});
