/**
 * Authored-artifact gate — the static (no-execution) safety scan applied to any
 * code the agent authors for itself (tools or skill scripts) BEFORE it is run or
 * registered. Blocking and ordered; the behavioural held-out scoring (which DOES
 * run the code, sandboxed) lives in sandbox-scorer.ts and runs only after this.
 *
 * @module agent/self-improvement/authored-artifact-gate
 */

import { matchAllDangerousPatterns } from '../../security/dangerous-patterns.js';

/** Omission placeholders that signal truncated / non-self-contained code. */
const OMISSION_RE = /\/\/\s*\.\.\.\s*(rest|remaining|other|more|implementation|code)\b|#\s*\.\.\.\s*(rest|remaining)\b/i;
/** Obvious secret shapes — never let an authored artifact embed these. */
const SECRET_RE =
  /(sk-[a-z0-9]{16,}|api[_-]?key\s*[:=]\s*['"]?\S{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16})/i;
/** Writing under src/ is the hard self-modification invariant — refuse it. */
const SRC_WRITE_RE = /(writeFile|writeFileSync|appendFile\w*|fs\.\w*write|open\s*\([^)]*['"]w|>>?\s*['"]?\.{0,2}\/?src\/)/i;
const MAX_CODE_BYTES = 64 * 1024;

export interface ArtifactGateResult {
  ok: boolean;
  reasons: string[];
}

/**
 * Statically inspect authored code. Returns ok=false with one or more reasons on
 * any finding. `subsystem` selects the dangerous-pattern set ('code' for tools,
 * 'skill' for skill scripts).
 */
export function inspectAuthoredCode(
  code: string,
  subsystem: 'code' | 'skill' = 'code',
): ArtifactGateResult {
  const reasons: string[] = [];
  const text = String(code ?? '');

  if (!text.trim()) reasons.push('code is empty');
  if (text.length > MAX_CODE_BYTES) reasons.push(`code too large (${text.length} > ${MAX_CODE_BYTES} bytes)`);

  const dangerous = matchAllDangerousPatterns(text, subsystem);
  if (dangerous.length > 0) {
    reasons.push(`matched ${dangerous.length} dangerous pattern(s): ${dangerous.map((d) => d.description).slice(0, 4).join('; ')}`);
  }
  if (SECRET_RE.test(text)) reasons.push('looks like it embeds a secret');
  if (OMISSION_RE.test(text)) reasons.push('contains an omission placeholder (not self-contained)');
  if (/src\//.test(text) && SRC_WRITE_RE.test(text)) {
    reasons.push('writes under src/ (forbidden self-modification invariant)');
  }

  return { ok: reasons.length === 0, reasons };
}
