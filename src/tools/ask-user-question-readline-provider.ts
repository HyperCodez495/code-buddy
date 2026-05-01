/**
 * AskUserQuestion Readline Provider — default CLI implementation
 *
 * Renders questions and parses answers using Node's `readline` module.
 * Drop-in replacement for richer providers (Ink, web, robot voice) when
 * Code Buddy embeds in a different runtime.
 *
 * Per ADR-01 (V4.3 refactor) — see `~/.claude/plans/lovely-brewing-bubble.md`.
 */

import * as readline from 'readline';
import type {
  AskUserQuestionInput,
  AskUserQuestionItem,
  AskUserQuestionUIProvider,
} from './ask-user-question-tool.js';

const TIMEOUT_SECONDS = 300;

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
    return new Promise((resolve) => {
      rl.question('   Enter your answer: ', (free) => {
        resolve(free.trim());
      });
    });
  }
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
// Provider
// ============================================================================

export class AskUserQuestionReadlineProvider implements AskUserQuestionUIProvider {
  /** TTY availability is checked at call-time, not construction, so the same
   * provider instance works across stdin TTY toggles (rare but possible). */
  isAvailable(): boolean {
    return Boolean(process.stdin.isTTY);
  }

  async ask(input: AskUserQuestionInput): Promise<Record<string, string>> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    const answers: Record<string, string> = {};
    const total = input.questions.length;

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
      throw new Error(`timed out after ${TIMEOUT_SECONDS}s`);
    }

    return answers;
  }
}

let _instance: AskUserQuestionReadlineProvider | null = null;

export function getAskUserQuestionReadlineProvider(): AskUserQuestionReadlineProvider {
  if (!_instance) _instance = new AskUserQuestionReadlineProvider();
  return _instance;
}

export function resetAskUserQuestionReadlineProvider(): void {
  _instance = null;
}
