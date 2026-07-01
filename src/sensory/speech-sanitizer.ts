/**
 * Speech sanitizer — the gate before ANY text is synthesized and sent to the speakers.
 *
 * The companion occasionally produces text that is fine to LOG but wrong to SPEAK:
 *   - leaked model control tokens / thinking blocks (`<think>`, `<|im_start|>`, GLM full-width…);
 *   - foreign-script contamination: a local model drifts mid-reply into CJK/Hangul — often a
 *     self-instruction it should never have emitted. Observed live, a French reply ending in
 *     "…tu peux<CJK>" ("…extend the sentence to make it more fluent"). A French Piper voice cannot
 *     pronounce that run, so the speaker plays garbage.
 *
 * `prepareSpeech()` strips both, then applies a "does this still say something?" floor (some
 * Latin letters or digits must remain). It returns the cleaned line, or `null` to stay silent.
 *
 * It deliberately does NOT try to catch *well-formed* nonsense (grammatical but hallucinated) —
 * that needs an LLM and per-utterance latency; this gate is deterministic and $0. Err toward
 * speaking: for a companion a rare artifact is less bad than a wrongly-muted real reply, so only
 * clearly-unpronounceable scripts (CJK/Hangul) are stripped, not every non-Latin script.
 *
 * @module sensory/speech-sanitizer
 */
import { sanitizeModelOutput, stripInvisibleChars } from '../utils/output-sanitizer.js';

/**
 * Runs of scripts a Latin-script (FR/EN) TTS voice cannot pronounce — in practice LLM
 * contamination rather than intended content: Han / Hiragana / Katakana / Hangul letters plus
 * CJK & full-width punctuation (U+3000–303F and U+FF00–FFEF, e.g. the full-width comma/period a
 * leaked Chinese clause carries). Stripped run-wise so the surrounding Latin text survives.
 */
const NON_LATIN_SCRIPT_RUN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]+/gu;

/** The floor for "this still says something speakable": at least one letter or digit. */
const HAS_SPEAKABLE_CONTENT = /[\p{L}\p{N}]/u;

/** Remove runs of unpronounceable (for a Latin voice) foreign script, leaving a space behind. */
export function stripForeignScript(text: string): string {
  return text.replace(NON_LATIN_SCRIPT_RUN, ' ');
}

/**
 * Clean a line for TTS. Returns the speakable text, or `null` when nothing meaningful remains
 * (empty, only punctuation/symbols/emoji, or only foreign-script / leaked-token residue) so the
 * caller can stay silent.
 */
export function prepareSpeech(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let t = sanitizeModelOutput(raw);
  t = stripInvisibleChars(t);
  // Replace foreign runs with a space (never ''), so Latin words on either side don't get glued
  // ("bonjour，patrice"), then collapse the doubles. We deliberately do NOT rewrite spacing around
  // punctuation: French keeps a space before ! ? : ; and touching it would mutate every clean reply.
  t = stripForeignScript(t).replace(/\s{2,}/g, ' ').trim();
  if (!t) return null;
  if (!HAS_SPEAKABLE_CONTENT.test(t)) return null;
  return t;
}
