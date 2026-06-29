import type { AgenticCodingTaskContract } from './agentic-coding-contract.js';

export interface CodexAutonomyDirectiveOptions {
  mode?: 'edit-proposal' | 'self-correction' | 'handoff';
}

function listOrFallback(values: string[], fallback: string): string {
  return values.length > 0 ? values.join(', ') : fallback;
}

/**
 * Bounded operating instructions for autonomous coding agents. This mirrors the
 * Codex loop shape without expanding the runner's authority: investigate,
 * maintain a live plan, protect user work, edit narrowly, then verify.
 */
export function renderCodexAutonomyDirective(
  contract: AgenticCodingTaskContract,
  options: CodexAutonomyDirectiveOptions = {},
): string {
  const mode = options.mode ?? 'edit-proposal';
  return [
    'Codex-style autonomous coding directive:',
    `- Mode: ${mode}.`,
    `- Scope: ${listOrFallback(contract.allowedPaths, 'no paths declared')}.`,
    `- Verification: ${listOrFallback(contract.verification, 'no verification declared')}.`,
    `- Budget: at most ${contract.maxFilesChanged} changed file(s), ${contract.maxToolRounds} tool round(s).`,
    '- Investigate first: read the workspace rules surfaced by the runner, inspect only relevant files, and prefer existing repository patterns.',
    '- Keep an explicit plan: break the task into short steps, keep one step in progress, and advance the plan only after real evidence.',
    '- Protect user work: treat dirty files as user-owned, never overwrite unrelated changes, and do not use reset, checkout, clean, push, deploy, or broad rewrites.',
    '- Edit narrowly: propose exact replace_text operations with exact occurrence counts; do not use placeholders or omitted code.',
    '- Validate before handoff: name the focused checks that should prove the change and call out residual risk when verification cannot run.',
    '- Stop honestly: report blocked instead of inventing edits when the safe scope, context, or verification is insufficient.',
  ].join('\n');
}
