/**
 * "Which LLM is good at what" — shared by the council
 * (`src/council/council-engine.ts`) and the latency-aware selector
 * (`model-selector.ts`). Kept in `fleet/` (not in the command) so the selector
 * doesn't pull the whole council → CodeBuddyClient graph just to classify a
 * model name, and so the dependency direction stays command → fleet.
 *
 * `inferStrengths` is a thin delegate to `getModelStrengths()` in
 * `config/model-tools.ts` — the single source of truth for per-model
 * capabilities (it used to be an independent regex layer that contradicted
 * the config booleans; see that module for the precedence rules).
 *
 * @module fleet/model-capability-heuristics
 */

import { getModelStrengths } from '../config/model-tools.js';
import type { ModelStrength } from './types.js';

/** Derive a model's likely strengths from its id (config-backed, see model-tools.ts). */
export function inferStrengths(model: string): ModelStrength[] {
  return getModelStrengths(model);
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
