import { describe, expect, it } from 'vitest';
import { toInferenceHistory } from '../src/renderer/components/user-model-inference';
import type { Message } from '../src/renderer/types';

function msg(role: Message['role'], ...texts: string[]): Message {
  return {
    id: `${role}-${texts.join('')}`,
    sessionId: 's1',
    role,
    content: texts.map((t) => ({ type: 'text', text: t })),
    timestamp: 1,
  } as Message;
}

describe('toInferenceHistory', () => {
  it('keeps user/assistant text turns and joins multi-block text', () => {
    const out = toInferenceHistory([
      msg('user', 'I prefer TypeScript', 'and ESM'),
      msg('assistant', 'Noted.'),
    ]);
    expect(out).toEqual([
      { type: 'user', content: 'I prefer TypeScript\nand ESM' },
      { type: 'assistant', content: 'Noted.' },
    ]);
  });

  it('drops non-user/assistant roles and empty turns', () => {
    const out = toInferenceHistory([
      msg('user', '  '),
      { id: 'tool', sessionId: 's1', role: 'tool' as Message['role'], content: [{ type: 'text', text: 'x' }], timestamp: 1 } as Message,
      msg('assistant', 'real answer'),
    ]);
    expect(out).toEqual([{ type: 'assistant', content: 'real answer' }]);
  });

  it('ignores non-text content blocks', () => {
    const m = {
      id: 'u1',
      sessionId: 's1',
      role: 'user',
      content: [{ type: 'tool_use', name: 'x' }, { type: 'text', text: 'hello' }],
      timestamp: 1,
    } as unknown as Message;
    expect(toInferenceHistory([m])).toEqual([{ type: 'user', content: 'hello' }]);
  });

  it('returns empty for no messages', () => {
    expect(toInferenceHistory([])).toEqual([]);
  });
});
