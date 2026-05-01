/**
 * AskUserQuestion Tool — Core Tests (V4.3 refactored)
 *
 * Tests validation and the provider-dispatch behavior. Interactive
 * readline rendering is tested separately in
 * `ask-user-question-readline-provider.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  executeAskUserQuestion,
  setAskUserQuestionUIProvider,
  resetAskUserQuestionUIProvider,
  type AskUserQuestionUIProvider,
  type AskUserQuestionInput,
} from '../../src/tools/ask-user-question-tool.js';

/** A scriptable fake provider that captures the input it received and returns
 * a predetermined answer map (or throws). Lets us verify dispatch without
 * touching readline. */
class FakeUIProvider implements AskUserQuestionUIProvider {
  available = true;
  capturedInput: AskUserQuestionInput | null = null;
  response: Record<string, string> = {};
  errorToThrow: Error | null = null;

  isAvailable(): boolean {
    return this.available;
  }
  async ask(input: AskUserQuestionInput): Promise<Record<string, string>> {
    this.capturedInput = input;
    if (this.errorToThrow) throw this.errorToThrow;
    return this.response;
  }
}

describe('AskUserQuestion Core', () => {
  let provider: FakeUIProvider;

  beforeEach(() => {
    provider = new FakeUIProvider();
    setAskUserQuestionUIProvider(provider);
  });

  afterEach(() => {
    resetAskUserQuestionUIProvider();
  });

  describe('validation', () => {
    it('rejects when questions is missing', async () => {
      const result = await executeAskUserQuestion({} as never);
      expect(result.success).toBe(false);
      expect(result.error).toContain('questions must be an array');
    });

    it('rejects when questions is empty', async () => {
      const result = await executeAskUserQuestion({ questions: [] });
      expect(result.success).toBe(false);
      expect(result.error).toContain('1–4 items');
    });

    it('rejects when questions exceeds 4', async () => {
      const result = await executeAskUserQuestion({
        questions: Array.from({ length: 5 }, (_, i) => ({
          question: `Q${i}?`,
          header: `H${i}`,
          options: [
            { label: 'a', description: 'd1' },
            { label: 'b', description: 'd2' },
          ],
        })),
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('1–4');
    });

    it('rejects when header exceeds 12 chars', async () => {
      const result = await executeAskUserQuestion({
        questions: [
          {
            question: 'pick?',
            header: 'this-is-way-too-long',
            options: [
              { label: 'a', description: 'd1' },
              { label: 'b', description: 'd2' },
            ],
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('≤12 chars');
    });

    it('rejects when options has fewer than 2 items', async () => {
      const result = await executeAskUserQuestion({
        questions: [
          {
            question: 'pick?',
            header: 'H',
            options: [{ label: 'only', description: 'd' }],
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('2–4');
    });

    it('rejects when options has more than 4 items', async () => {
      const result = await executeAskUserQuestion({
        questions: [
          {
            question: 'pick?',
            header: 'H',
            options: Array.from({ length: 5 }, (_, i) => ({
              label: `o${i}`,
              description: 'd',
            })),
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('2–4');
    });

    it('rejects when option label is empty', async () => {
      const result = await executeAskUserQuestion({
        questions: [
          {
            question: 'pick?',
            header: 'H',
            options: [
              { label: '', description: 'd' },
              { label: 'b', description: 'd' },
            ],
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('label');
    });
  });

  describe('provider gating', () => {
    it('returns explicit error when no provider is registered', async () => {
      resetAskUserQuestionUIProvider();
      const result = await executeAskUserQuestion({
        questions: [
          {
            question: 'pick?',
            header: 'H',
            options: [
              { label: 'a', description: 'd1' },
              { label: 'b', description: 'd2' },
            ],
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No provider available');
      expect(result.error).toContain('best judgement');
    });

    it('returns explicit error when provider reports not available', async () => {
      provider.available = false;
      const result = await executeAskUserQuestion({
        questions: [
          {
            question: 'pick?',
            header: 'H',
            options: [
              { label: 'a', description: 'd1' },
              { label: 'b', description: 'd2' },
            ],
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('No provider available');
    });
  });

  describe('provider dispatch', () => {
    it('passes the validated input to the provider verbatim', async () => {
      provider.response = { H: 'a' };
      const input: AskUserQuestionInput = {
        questions: [
          {
            question: 'pick?',
            header: 'H',
            options: [
              { label: 'a', description: 'd1' },
              { label: 'b', description: 'd2' },
            ],
          },
        ],
      };

      await executeAskUserQuestion(input);
      expect(provider.capturedInput).toEqual(input);
    });

    it('returns the provider answers serialized as JSON in output', async () => {
      provider.response = { fruit: 'banana', color: 'orange' };
      const result = await executeAskUserQuestion({
        questions: [
          {
            question: 'pick?',
            header: 'fruit',
            options: [
              { label: 'apple', description: 'a' },
              { label: 'banana', description: 'b' },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
      expect(JSON.parse(result.output!)).toEqual({ fruit: 'banana', color: 'orange' });
    });

    it('wraps thrown provider errors as ToolResult.error', async () => {
      provider.errorToThrow = new Error('timed out after 300s');
      const result = await executeAskUserQuestion({
        questions: [
          {
            question: 'pick?',
            header: 'H',
            options: [
              { label: 'a', description: 'd1' },
              { label: 'b', description: 'd2' },
            ],
          },
        ],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('failed');
      expect(result.error).toContain('timed out after 300s');
    });
  });
});
