/**
 * Tiny, dependency-free heuristics for "which LLM is good at what" — shared by
 * the council (`src/commands/council.ts`) and the latency-aware selector
 * (`model-selector.ts`). Kept in `fleet/` (not in the command) so the selector
 * doesn't pull the whole council → CodeBuddyClient graph just to classify a
 * model name, and so the dependency direction stays command → fleet.
 *
 * These are name-pattern heuristics, intentionally crude: they need to be
 * directionally right, not exact. The ModelScoreboard's measured data is what
 * actually decides once it exists.
 *
 * @module fleet/model-capability-heuristics
 */

import type { ModelStrength } from './types.js';

/** Derive a model's likely strengths from its id (name-pattern heuristic). */
export function inferStrengths(model: string): ModelStrength[] {
  const m = model.toLowerCase();
  const s = new Set<ModelStrength>(['tool-calling']);
  if (/code|coder|codex/.test(m)) s.add('code');
  if (/opus|gpt-5|o1|o3|reason|think|r1|qwq|deepseek/.test(m)) {
    s.add('reasoning');
    s.add('thinking');
  }
  if (/gpt-5|gemini|sonnet|opus|grok-[34]|grok-4/.test(m)) s.add('reasoning');
  if (/flash|mini|fast|haiku|small|nano|:3b|:4b|:7b|:8b/.test(m)) {
    s.add('fast');
    s.add('cheap');
  }
  if (/gemini|pro|opus|sonnet|long|1m|200k|128k/.test(m)) s.add('long-context');
  if (/mistral|qwen|gemma|mixtral/.test(m)) s.add('french');
  if (/vision|gpt-4o|gpt-5|gemini|grok-2-vision/.test(m)) s.add('vision');
  return [...s];
}

/** Classify a task from its text (code / reasoning / vision / french / general). */
export function inferTaskType(task: string): string {
  const t = task.toLowerCase();
  if (/\b(code|fonction|function|bug|refactor|impl[ée]ment|classe|class|api|script|compile|regex|sql)\b/.test(t))
    return 'code';
  if (/\b(prouve|d[ée]montre|raisonn|reason|prove|analyse|strat[ée]gie|pourquoi|math|calcul|optimi)\b/.test(t))
    return 'reasoning';
  if (/\b(image|photo|capture|screenshot|diagram|graph)\b/.test(t)) return 'vision';
  if (/[éèàçùêîô]/.test(task) || /\b(fran[çc]ais|france|french)\b/.test(t)) return 'french';
  return 'general';
}
