import { describe, expect, it, vi } from 'vitest';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';
import { IncrementalMessageTokenCounter } from '../../../src/agent/execution/incremental-token-counter.js';

function countBatch(messages: CodeBuddyMessage[]): number {
  return messages.reduce(
    (total, message) => total + 3 + (typeof message.content === 'string' ? message.content.length : 0),
    0,
  );
}

describe('IncrementalMessageTokenCounter', () => {
  it('counts only appended messages and matches a full recount', () => {
    const count = vi.fn(countBatch);
    const incremental = new IncrementalMessageTokenCounter(count);
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
    ];

    expect(incremental.count(messages)).toBe(countBatch(messages));
    messages.push(
      { role: 'user', content: 'three' },
      { role: 'assistant', content: 'four' },
    );
    expect(incremental.count(messages)).toBe(countBatch(messages));

    expect(count).toHaveBeenCalledTimes(2);
    expect(count.mock.calls[1]?.[0]).toEqual(messages.slice(2));
  });

  it('recounts the full transcript after compaction invalidation', () => {
    const count = vi.fn(countBatch);
    const incremental = new IncrementalMessageTokenCounter(count);
    const messages: CodeBuddyMessage[] = [
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'answer' },
    ];
    incremental.count(messages);

    messages.splice(0, messages.length, { role: 'system', content: 'summary' });
    incremental.invalidate();

    expect(incremental.count(messages)).toBe(countBatch(messages));
    expect(count.mock.calls.at(-1)?.[0]).toEqual(messages);
  });
});
