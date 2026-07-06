/**
 * Shared LLM-output JSON parsing.
 *
 * `extractJsonObject` is the two-stage strict parse (pure JSON, then greedy
 * `{…}` match) that was duplicated verbatim in the council judge, the diff
 * reviewer and the revision loop — one implementation, fail-closed (null on
 * anything unreliable).
 *
 * `salvageJsonObjects` goes one step further for *array-of-items* outputs
 * (finding lists, initiative lists, batch results): when the model's output is
 * truncated mid-array, it recovers every COMPLETE top-level object by brace
 * depth counting (string- and escape-aware) instead of discarding the whole
 * answer. The trailing partial object is dropped. Inspired by jarvis-OS's
 * `_salvage_json` (concept only — clean-room reimplementation).
 */

export function extractJsonObject<T>(text: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    /* not pure JSON */
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      /* salvage failed */
    }
  }
  return null;
}

/**
 * Recover every complete top-level `{…}` object from possibly-truncated text.
 * Objects that fail to parse individually are skipped; a partial trailing
 * object (cut by truncation) is dropped. Returns `[]` when nothing survives.
 */
export function salvageJsonObjects<T>(text: string): T[] {
  if (!text) return [];
  const out: T[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      // A quote outside any object opens a string only when we are inside one
      // being tracked; at depth 0 it may be array glue — still track it so a
      // brace inside a top-level string never opens a phantom object.
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            out.push(JSON.parse(text.slice(start, i + 1)) as T);
          } catch {
            /* skip an individually malformed object */
          }
          start = -1;
        }
      }
    }
  }
  return out;
}
