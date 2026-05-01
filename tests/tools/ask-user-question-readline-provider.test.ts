/**
 * AskUserQuestion Readline Provider Tests
 *
 * Exercises the actual readline-based interactive paths : numeric pick,
 * "Other" free-text branch, multi-select parsing, multi-question loop,
 * prompt rendering, empty-input default. Mocks readline.createInterface
 * to simulate user keyboard input.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockRlQuestion, mockRlClose } = vi.hoisted(() => ({
  mockRlQuestion: vi.fn(),
  mockRlClose: vi.fn(),
}));

vi.mock('readline', () => ({
  createInterface: vi.fn(() => ({
    question: mockRlQuestion,
    close: mockRlClose,
  })),
}));

import { AskUserQuestionReadlineProvider } from '../../src/tools/ask-user-question-readline-provider.js';

function queueAnswers(...answers: string[]): void {
  let i = 0;
  mockRlQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => {
    const answer = answers[i++] ?? '';
    setImmediate(() => cb(answer));
  });
}

describe('AskUserQuestionReadlineProvider', () => {
  let originalIsTTY: boolean | undefined;
  let provider: AskUserQuestionReadlineProvider;

  beforeEach(() => {
    originalIsTTY = process.stdin.isTTY;
    mockRlQuestion.mockReset();
    mockRlClose.mockReset();
    provider = new AskUserQuestionReadlineProvider();
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
      writable: true,
    });
  });

  function setTTY(value: boolean) {
    Object.defineProperty(process.stdin, 'isTTY', {
      value,
      configurable: true,
      writable: true,
    });
  }

  describe('isAvailable()', () => {
    it('returns true when stdin is a TTY', () => {
      setTTY(true);
      expect(provider.isAvailable()).toBe(true);
    });

    it('returns false when stdin is not a TTY', () => {
      setTTY(false);
      expect(provider.isAvailable()).toBe(false);
    });
  });

  describe('ask() — single-select', () => {
    beforeEach(() => setTTY(true));

    it('returns the option label when user picks a valid number', async () => {
      queueAnswers('2');
      const answers = await provider.ask({
        questions: [
          {
            question: 'pick?',
            header: 'fruit',
            options: [
              { label: 'apple', description: 'red' },
              { label: 'banana', description: 'yellow' },
              { label: 'cherry', description: 'small' },
            ],
          },
        ],
      });
      expect(answers.fruit).toBe('banana');
      expect(mockRlClose).toHaveBeenCalled();
    });

    it('routes "Other" pick (last+1) to free-text follow-up prompt', async () => {
      queueAnswers('3', 'my custom answer');
      const answers = await provider.ask({
        questions: [
          {
            question: 'pick?',
            header: 'h',
            options: [
              { label: 'a', description: 'd1' },
              { label: 'b', description: 'd2' },
            ],
          },
        ],
      });
      expect(answers.h).toBe('my custom answer');
      expect(mockRlQuestion).toHaveBeenCalledTimes(2);
      expect(mockRlQuestion.mock.calls[1]![0]).toContain('Enter your answer');
    });

    it('preserves free-text fallback when user types non-numeric input', async () => {
      queueAnswers('skip this whole thing');
      const answers = await provider.ask({
        questions: [
          {
            question: 'pick?',
            header: 'h',
            options: [
              { label: 'a', description: 'd1' },
              { label: 'b', description: 'd2' },
            ],
          },
        ],
      });
      expect(answers.h).toBe('skip this whole thing');
    });

    it('records "(no answer)" when user submits empty input', async () => {
      queueAnswers('');
      const answers = await provider.ask({
        questions: [
          {
            question: 'pick?',
            header: 'h',
            options: [
              { label: 'a', description: 'd1' },
              { label: 'b', description: 'd2' },
            ],
          },
        ],
      });
      expect(answers.h).toBe('(no answer)');
    });
  });

  describe('ask() — multi-select', () => {
    beforeEach(() => setTTY(true));

    it('expands comma-separated numbers to labels', async () => {
      queueAnswers('1,3');
      const answers = await provider.ask({
        questions: [
          {
            question: 'pick?',
            header: 'multi',
            multiSelect: true,
            options: [
              { label: 'a', description: 'd1' },
              { label: 'b', description: 'd2' },
              { label: 'c', description: 'd3' },
            ],
          },
        ],
      });
      expect(answers.multi).toBe('a, c');
    });
  });

  describe('ask() — multi-question', () => {
    beforeEach(() => setTTY(true));

    it('asks all questions in order and returns a header→answer map', async () => {
      queueAnswers('1', '2');
      const answers = await provider.ask({
        questions: [
          {
            question: 'first?',
            header: 'q1',
            options: [
              { label: 'alpha', description: 'a' },
              { label: 'beta', description: 'b' },
            ],
          },
          {
            question: 'second?',
            header: 'q2',
            options: [
              { label: 'gamma', description: 'g' },
              { label: 'delta', description: 'd' },
            ],
          },
        ],
      });
      expect(answers.q1).toBe('alpha');
      expect(answers.q2).toBe('delta');
      expect(mockRlQuestion).toHaveBeenCalledTimes(2);
    });
  });

  describe('ask() — rendering', () => {
    beforeEach(() => setTTY(true));

    it('renders option labels, descriptions, header, and "Other" in the prompt', async () => {
      queueAnswers('1');
      await provider.ask({
        questions: [
          {
            question: 'which color?',
            header: 'color',
            options: [
              { label: 'orange', description: 'warm color' },
              { label: 'blue', description: 'cool color' },
            ],
          },
        ],
      });

      const renderedPrompt = mockRlQuestion.mock.calls[0]![0];
      expect(renderedPrompt).toContain('which color?');
      expect(renderedPrompt).toContain('[color]');
      expect(renderedPrompt).toContain('orange');
      expect(renderedPrompt).toContain('warm color');
      expect(renderedPrompt).toContain('Other');
    });
  });
});
