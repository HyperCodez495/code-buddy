import { beforeEach, describe, expect, it, vi } from 'vitest';

const propose = vi.fn((input: { category: string; content: string }) => ({
  candidate: { id: 'c1', ...input, status: 'pending' },
  deduped: false,
}));

vi.mock('../../src/agent/lesson-candidate-queue.js', () => ({
  getLessonCandidateQueue: () => ({ propose }),
}));

import { proposeLessonsFromSession } from '../../src/agent/lesson-auto-proposer.js';
import type { ChatEntry } from '../../src/agent/types.js';

function history(): ChatEntry[] {
  return [
    { type: 'user', content: 'always run typecheck before done', timestamp: new Date() } as ChatEntry,
    { type: 'assistant', content: 'ok', timestamp: new Date() } as ChatEntry,
  ];
}

function fakeClient(reply: string) {
  return { chat: vi.fn(async () => ({ choices: [{ message: { content: reply } }] })) } as never;
}

describe('proposeLessonsFromSession (D2)', () => {
  beforeEach(() => propose.mockClear());

  it('returns [] and never calls the LLM for empty history', async () => {
    const client = fakeClient('[]');
    const res = await proposeLessonsFromSession([], '/tmp', client);
    expect(res).toEqual([]);
    expect(propose).not.toHaveBeenCalled();
  });

  it('parses a JSON array and proposes each valid candidate (PENDING, review-gated)', async () => {
    const client = fakeClient(
      '[{"category":"RULE","content":"Run typecheck before marking done"},{"category":"PATTERN","content":"ESM imports need .js"}]',
    );
    const res = await proposeLessonsFromSession(history(), '/tmp', client);
    expect(res).toHaveLength(2);
    expect(propose).toHaveBeenCalledTimes(2);
    expect(propose).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'RULE', source: 'self_observed' }),
    );
  });

  it('strips code fences and skips invalid categories', async () => {
    const client = fakeClient('```json\n[{"category":"NOPE","content":"x"},{"category":"insight","content":"valid"}]\n```');
    const res = await proposeLessonsFromSession(history(), '/tmp', client);
    expect(res).toHaveLength(1);
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({ category: 'INSIGHT' }));
  });

  it('returns [] on malformed reply without throwing', async () => {
    const res = await proposeLessonsFromSession(history(), '/tmp', fakeClient('not json at all'));
    expect(res).toEqual([]);
    expect(propose).not.toHaveBeenCalled();
  });

  it('returns [] when the LLM call throws', async () => {
    const client = { chat: vi.fn(async () => { throw new Error('boom'); }) } as never;
    const res = await proposeLessonsFromSession(history(), '/tmp', client);
    expect(res).toEqual([]);
  });
});
