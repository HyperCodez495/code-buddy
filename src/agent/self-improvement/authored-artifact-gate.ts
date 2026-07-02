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
/**
 * Any filesystem-WRITE API. An authored tool's contract is "read input from
 * env, print result to stdout" — it has no reason to write files. Flagging
 * every write API (not just literal `src/` targets) closes the audited
 * bypasses: string-split targets (`'sr'+'c'`), dynamic paths, and
 * catastrophic non-src targets (`.git/hooks/pre-commit`, `~/.ssh/…`, the
 * AuthoredToolStore JSON, a poisoned SKILL.md).
 */
const FS_WRITE_RE =
  /\b(writeFile|writeFileSync|appendFile\w*|createWriteStream|mkdir\w*|rename\w*|copyFile\w*|truncate\w*|chmod\w*|symlink\w*)\s*\(|\bfs\.\w*(write|append|open)\w*|\bopen\s*\([^)]*['"][wa]/i;
/**
 * Network egress. Env isolation already denies inherited secrets, but an
 * authored compute tool has no reason to open the network — belt and braces
 * against exfiltration. (This subsystem is authored tools only; the general
 * execute_code tool does NOT pass through this gate.)
 */
const NETWORK_RE =
  /\bfetch\s*\(\s*['"`]https?:|\brequire\s*\(\s*['"`](?:https?|net|dgram|dns|tls)['"`]\)|\bimport\s*\(\s*['"`](?:node:)?(?:https?|net|dgram|dns|tls)['"`]\)|\bnew\s+WebSocket\b|\bXMLHttpRequest\b|\bnavigator\.sendBeacon\b/i;
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

  // Authored tools (subsystem 'code') read input + print to stdout — no writes,
  // no network. Skills use a different scanner (scanSkillFirewall) so keep the
  // legacy src/-only write check for them to avoid changing that path.
  if (subsystem === 'code') {
    if (FS_WRITE_RE.test(text)) {
      reasons.push('performs a filesystem write (authored tools must only read input + print to stdout)');
    }
    if (NETWORK_RE.test(text)) {
      reasons.push('opens the network (authored tools must not make outbound requests)');
    }
  } else if (/src\//.test(text) && /(writeFile|writeFileSync|appendFile\w*|fs\.\w*write)/i.test(text)) {
    reasons.push('writes under src/ (forbidden self-modification invariant)');
  }

  return { ok: reasons.length === 0, reasons };
}
