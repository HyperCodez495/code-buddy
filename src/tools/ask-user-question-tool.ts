/**
 * AskUserQuestion Tool (Claude Code 2026-style)
 *
 * Lets the LLM ask the user 1–4 structured multi-option questions in the
 * middle of a task. The tool blocks on readline, presenting each question
 * with a numbered options list (and an auto-appended "Other" choice for
 * free-text fallback). Returns a structured map { <header>: <answer> } so
 * the LLM can disambiguate which question each answer addresses.
 *
 * Non-TTY behavior (per V4.3 design Q2 — option B "explicit error"):
 *   When stdin is not a TTY (one-shot --prompt, CI, headless API server),
 *   the tool returns success=false with a clear error so the agent can
 *   auto-decide rather than silently picking a default.
 */

import * as readline from 'readline';
import type { ToolResult } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

export interface AskUserQuestionOption {
  /** Short label shown in the picker (1–5 words) */
  label: string;
  /** Explanation of what this option means or what happens if chosen */
  description: string;
  /** Optional preview content (mockup, code snippet) — currently rendered as
   * an indented block under the option, no rich diff view in readline mode */
  preview?: string;
}

export interface AskUserQuestionItem {
  /** The full question text, ending with a question mark */
  question: string;
  /** Short chip label (max 12 chars) — used as the key in the result map */
  header: string;
  /** 2–4 options the user can pick from */
  options: AskUserQuestionOption[];
  /** When true, allow multiple answers (comma-separated input) */
  multiSelect?: boolean;
}

export interface AskUserQuestionInput {
  /** 1–4 questions to ask */
  questions: AskUserQuestionItem[];
}

// ============================================================================
// Constants
// ============================================================================

const MAX_QUESTIONS = 4;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const MAX_HEADER_LEN = 12;
const TIMEOUT_SECONDS = 300;

// ============================================================================
// Validation
// ============================================================================

function validateInput(input: AskUserQuestionInput): string | null {
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
// Rendering
// ============================================================================

function renderQuestion(q: AskUserQuestionItem, index: number, total: number): string {
  let out = '';
  if (total > 1) out += `\n[${index + 1}/${total}] `;
  else out += '\n';
  out += `🤔 ${q.question}\n`;
  out += `    [${q.header}]\n\n`;

  q.options.forEach((opt, i) => {
    out += `  ${i + 1}. ${opt.label}\n     ${opt.description}\n`;
    if (opt.preview) {
      const indented = opt.preview.split('\n').map(l => `     │ ${l}`).join('\n');
      out += `${indented}\n`;
    }
  });
  out += `  ${q.options.length + 1}. Other (provide free-text answer)\n\n`;
  if (q.multiSelect) {
    out += `Pick one or more (comma-separated numbers, e.g. "1,3"): `;
  } else {
    out += `Pick one (number): `;
  }
  return out;
}

// ============================================================================
// Answer parsing
// ============================================================================

function parseSingleAnswer(
  raw: string,
  q: AskUserQuestionItem,
  rl: readline.Interface,
): Promise<string> {
  const trimmed = raw.trim();
  if (trimmed === '') return Promise.resolve('');

  const n = parseInt(trimmed, 10);
  if (!isNaN(n) && n >= 1 && n <= q.options.length) {
    return Promise.resolve(q.options[n - 1]!.label);
  }
  if (!isNaN(n) && n === q.options.length + 1) {
    // "Other" — prompt for free text
    return new Promise((resolve) => {
      rl.question('   Enter your answer: ', (free) => {
        resolve(free.trim());
      });
    });
  }
  // Free-text fallback (anything that isn't a valid number)
  return Promise.resolve(trimmed);
}

async function parseMultiAnswer(
  raw: string,
  q: AskUserQuestionItem,
  rl: readline.Interface,
): Promise<string> {
  const trimmed = raw.trim();
  if (trimmed === '') return '';

  const parts = trimmed.split(',').map(p => p.trim()).filter(p => p !== '');
  const labels: string[] = [];
  let needsFreeText = false;
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (!isNaN(n) && n >= 1 && n <= q.options.length) {
      labels.push(q.options[n - 1]!.label);
    } else if (!isNaN(n) && n === q.options.length + 1) {
      needsFreeText = true;
    } else {
      // Free-text token — keep as-is
      labels.push(p);
    }
  }
  if (needsFreeText) {
    const free = await new Promise<string>((resolve) => {
      rl.question('   Enter your free-text answer: ', (s) => resolve(s.trim()));
    });
    if (free) labels.push(free);
  }
  return labels.join(', ');
}

// ============================================================================
// Tool implementation
// ============================================================================

export async function executeAskUserQuestion(
  input: AskUserQuestionInput,
): Promise<ToolResult> {
  const validationError = validateInput(input);
  if (validationError) {
    return { success: false, error: validationError };
  }

  // Non-TTY: explicit error per V4.3 design Q2 option B
  if (!process.stdin.isTTY) {
    return {
      success: false,
      error:
        'ask_user_question requires an interactive TTY. Detected non-interactive ' +
        'environment (CI, --prompt one-shot, or headless server). Decide using your ' +
        'best judgement and proceed without user input.',
    };
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const answers: Record<string, string> = {};
  const total = input.questions.length;

  // Global timeout across all questions
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    rl.close();
  }, TIMEOUT_SECONDS * 1000);

  try {
    for (let i = 0; i < input.questions.length; i++) {
      if (timedOut) break;
      const q = input.questions[i]!;
      const prompt = renderQuestion(q, i, total);

      const raw = await new Promise<string>((resolve) => {
        rl.question(prompt, resolve);
      });
      if (timedOut) break;

      const parsed = q.multiSelect
        ? await parseMultiAnswer(raw, q, rl)
        : await parseSingleAnswer(raw, q, rl);

      answers[q.header] = parsed || '(no answer)';
    }
  } finally {
    clearTimeout(timer);
    rl.close();
  }

  if (timedOut) {
    return {
      success: false,
      error: `ask_user_question timed out after ${TIMEOUT_SECONDS}s. Decide using your best judgement.`,
    };
  }

  return {
    success: true,
    output: JSON.stringify(answers, null, 2),
  };
}
