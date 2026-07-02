/**
 * Relational context — Lisa's felt sense of the person she's talking to, composed into one compact
 * block to prepend to a spoken reply or an arrival opener.
 *
 * This is the "wire, don't rewrite" seam of the interactions refonte: two rich engines were already
 * built but DISCONNECTED from the voice path —
 *   - `user-model.ts` — a privacy-screened, review-gated model of Patrice's working preferences
 *     (accepted observations only; sensitive content is refused at WRITE time, never a dossier);
 *   - `relationship-state.ts` — Lisa's own evolving mood/traits/rapport (Phase 1);
 * plus the live camera `presence` block. None were read by any `sensory`/`companion` surface. This
 * module composes them so a reply can KNOW something about him and REFLECT her own state, instead of
 * reasoning only over the last few raw percepts.
 *
 * Every piece is optional + best-effort: a failing/empty source contributes nothing, and the whole
 * thing never throws (a broken source degrades to a plainer prompt, never a crashed voice loop).
 * The call sites gate the actual injection behind `CODEBUDDY_COMPANION_RELATIONAL` (default off), so
 * turning it on is an explicit choice; this composer itself is env-free and unit-testable.
 *
 * @module companion/relational-context
 */
import { getUserModel } from '../memory/user-model.js';
import { injectPresenceBlock } from '../memory/presence-injector.js';
import { loadRelationshipState, getPersonalitySummary } from './relationship-state.js';

export interface RelationalContextOptions {
  cwd?: string;
  /** Include the accepted user-model facts block. Default true. */
  includeFacts?: boolean;
  /** Include Lisa's personality/mood summary. Default true. */
  includePersonality?: boolean;
  /** Include the live camera-presence block. Default true. */
  includePresence?: boolean;
  /** Injectable seams (tests) — each defaults to the real source above. */
  factsBlock?: () => string | null;
  personalitySummary?: () => string;
  presenceBlock?: () => Promise<string>;
  /** Override the relationship-state file (tests). */
  relationshipStatePath?: string;
}

/**
 * Compose the relational context string. Returns '' when nothing useful is available (caller can
 * splice unconditionally). Order: what she knows about him → her own state → who's present now.
 */
export async function buildRelationalContext(options: RelationalContextOptions = {}): Promise<string> {
  const parts: string[] = [];

  if (options.includeFacts !== false) {
    try {
      const facts = options.factsBlock
        ? options.factsBlock()
        : getUserModel(options.cwd ?? process.cwd()).summarize();
      if (facts && facts.trim()) parts.push(facts.trim());
    } catch {
      /* best-effort — no facts is fine */
    }
  }

  if (options.includePersonality !== false) {
    try {
      const summary = options.personalitySummary
        ? options.personalitySummary()
        : getPersonalitySummary(loadRelationshipState(options.relationshipStatePath));
      if (summary && summary.trim()) parts.push(`<lisa_state>\n${summary.trim()}\n</lisa_state>`);
    } catch {
      /* best-effort */
    }
  }

  if (options.includePresence !== false) {
    try {
      const presence = options.presenceBlock ? await options.presenceBlock() : await injectPresenceBlock();
      if (presence && presence.trim()) parts.push(presence.trim());
    } catch {
      /* best-effort */
    }
  }

  return parts.join('\n\n');
}

/** True when the relational-context injection is enabled (call sites gate on this). */
export function isRelationalContextEnabled(): boolean {
  return process.env.CODEBUDDY_COMPANION_RELATIONAL === 'true';
}
