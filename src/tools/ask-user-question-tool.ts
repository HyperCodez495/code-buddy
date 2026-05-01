/**
 * AskUserQuestion Tool — Core (V4.3 refactored 2026-05-01)
 *
 * Lets the LLM ask the user 1–4 structured multi-option questions in the
 * middle of a task. Returns a structured map { <header>: <answer> } so
 * the LLM can disambiguate which question each answer addresses.
 *
 * This module is the **UI-agnostic core** : it owns types, validation,
 * and dispatches the rendering/parsing to a registered UI provider.
 * The default CLI provider (readline-based) lives in
 * `ask-user-question-readline-provider.ts` and is registered at startup
 * by `codebuddy-agent.ts`. Future Ink, web, robot, or voice providers
 * can register their own implementation without touching this file.
 *
 * Per ADR-01 (V4.3 refactor) — see `~/.claude/plans/lovely-brewing-bubble.md`.
 */

import type { ToolResult } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

export interface AskUserQuestionOption {
  /** Short label shown in the picker (1–5 words) */
  label: string;
  /** Explanation of what this option means or what happens if chosen */
  description: string;
  /** Optional preview content (mockup, code snippet) */
  preview?: string;
}

export interface AskUserQuestionItem {
  /** The full question text, ending with a question mark */
  question: string;
  /** Short chip label (max 12 chars) — used as the key in the result map */
  header: string;
  /** 2–4 options the user can pick from */
  options: AskUserQuestionOption[];
  /** When true, allow multiple answers */
  multiSelect?: boolean;
}

export interface AskUserQuestionInput {
  /** 1–4 questions to ask */
  questions: AskUserQuestionItem[];
}

/**
 * UI provider contract. Implementations render the questions and collect
 * answers from the user, returning a header → answer map. The provider is
 * responsible for handling its own non-availability case (e.g., a CLI
 * readline provider returns isAvailable() === false in non-TTY).
 */
export interface AskUserQuestionUIProvider {
  /**
   * Present the questions to the user and return their answers, keyed by
   * each question's header.
   */
  ask(input: AskUserQuestionInput): Promise<Record<string, string>>;
  /**
   * Whether this provider can serve a request right now (e.g., TTY available,
   * UI client connected).
   */
  isAvailable(): boolean;
}

// ============================================================================
// Constants
// ============================================================================

export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_HEADER_LEN = 12;

// ============================================================================
// Provider injection
// ============================================================================

let _uiProvider: AskUserQuestionUIProvider | null = null;

/**
 * Register the UI provider. Called once at agent startup. Multiple registrations
 * replace the previous provider (last writer wins).
 */
export function setAskUserQuestionUIProvider(provider: AskUserQuestionUIProvider): void {
  _uiProvider = provider;
}

/**
 * Reset the provider (for testing).
 */
export function resetAskUserQuestionUIProvider(): void {
  _uiProvider = null;
}

/**
 * Get the currently registered provider (for advanced testing scenarios).
 */
export function getAskUserQuestionUIProvider(): AskUserQuestionUIProvider | null {
  return _uiProvider;
}

// ============================================================================
// Validation
// ============================================================================

export function validateInput(input: AskUserQuestionInput): string | null {
  if (!input.questions || !Array.isArray(input.questions)) {
    return 'questions must be an array';
  }
  if (input.questions.length < 1 || input.questions.length > MAX_QUESTIONS) {
    return `questions must contain 1–${MAX_QUESTIONS} items (got ${input.questions.length})`;
  }
  for (let i = 0; i < input.questions.length; i++) {
    const q = input.questions[i]!;
    if (!q.question || typeof q.question !== 'string' || q.question.trim() === '') {
      return `question[${i}].question must be a non-empty string`;
    }
    if (!q.header || typeof q.header !== 'string' || q.header.trim() === '') {
      return `question[${i}].header must be a non-empty string`;
    }
    if (q.header.length > MAX_HEADER_LEN) {
      return `question[${i}].header must be ≤${MAX_HEADER_LEN} chars (got ${q.header.length})`;
    }
    if (!q.options || !Array.isArray(q.options)) {
      return `question[${i}].options must be an array`;
    }
    if (q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS) {
      return `question[${i}].options must contain ${MIN_OPTIONS}–${MAX_OPTIONS} items`;
    }
    for (let j = 0; j < q.options.length; j++) {
      const opt = q.options[j]!;
      if (!opt.label || typeof opt.label !== 'string') {
        return `question[${i}].options[${j}].label must be a non-empty string`;
      }
      if (!opt.description || typeof opt.description !== 'string') {
        return `question[${i}].options[${j}].description must be a non-empty string`;
      }
    }
  }
  return null;
}

// ============================================================================
// Tool implementation (delegates to provider)
// ============================================================================

export async function executeAskUserQuestion(
  input: AskUserQuestionInput,
): Promise<ToolResult> {
  const validationError = validateInput(input);
  if (validationError) {
    return { success: false, error: validationError };
  }

  if (!_uiProvider || !_uiProvider.isAvailable()) {
    return {
      success: false,
      error:
        'ask_user_question requires an interactive UI. No provider available ' +
        '(CI, --prompt one-shot, headless server, or provider not registered). ' +
        'Decide using your best judgement and proceed without user input.',
    };
  }

  try {
    const answers = await _uiProvider.ask(input);
    return {
      success: true,
      output: JSON.stringify(answers, null, 2),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `ask_user_question failed: ${msg}`,
    };
  }
}
