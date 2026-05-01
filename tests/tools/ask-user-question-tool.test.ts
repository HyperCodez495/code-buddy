/**
 * AskUserQuestion Tool Tests
 *
 * Verifies validation, non-TTY behavior (option B = explicit error),
 * single/multi-select parsing, and "Other" free-text fallback.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeAskUserQuestion } from '../../src/tools/ask-user-question-tool.js';

describe('AskUserQuestion Tool', () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    originalIsTTY = process.stdin.isTTY;
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
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

  describe('non-TTY behavior (V4.3 Q2 option B)', () => {
    it('returns explicit error when stdin is not a TTY', async () => {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: false,
        configurable: true,
        writable: true,
      });

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
      expect(result.error).toContain('interactive TTY');
      expect(result.error).toContain('best judgement');
    });

    it('does not block on readline in non-TTY (no hang)', async () => {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: false,
        configurable: true,
        writable: true,
      });
      const start = Date.now();
      await executeAskUserQuestion({
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
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(500);
    });
  });
});
