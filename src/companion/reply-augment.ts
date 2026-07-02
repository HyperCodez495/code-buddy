/**
 * Reply augmentation — emotion-aware tone + anti-repetition for Lisa's spoken replies.
 *
 * MySoulmate shifts persona/tone by the user's detected emotion (`EmotionDetector` → per-emotion
 * playbook) and down-weights recently-used phrasings so it doesn't repeat the same beat. This is the
 * portable core of both, kept pure + deterministic so it's trivially testable and cheap to call on
 * every utterance:
 *   - `detectRelationalSignal(heard)` — the dominant emotional colouring of what he just said,
 *     as a `RelationalSignal` (so the SAME value drives both the tone shift AND Phase-1 trait drift);
 *   - `registerGuidanceForSignal(signal)` — a one-line tone instruction for the reply system prompt
 *     (the caring.md playbook: on frustration, soften and be present, don't rush a fix);
 *   - opener-ring helpers — track the last few reply openings and tell the model to vary its entry.
 *
 * Frustration is checked FIRST so a mixed utterance ("merci mais je galère") still triggers the
 * caring register rather than being read as gratitude.
 *
 * @module companion/reply-augment
 */
import type { RelationalSignal } from './relationship-state.js';

/** Lowercase, strip diacritics (STT accent loss "ca" ≈ "ça"), and fold apostrophes + punctuation to
 *  spaces so "je t'aime" → "je t aime" and openers are clean word sequences. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ') // apostrophes/punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

// All patterns match against the normalized (accent-stripped) text.
const RE = {
  frustration: /\b(j en peux plus|marre|galere|bloque|coince|ca marche pas|enerve|fatigue|epuise|sais plus|stresse|angoisse|j y arrive pas|c est dur|trop dur)\b/,
  affection: /\b(je t aime|tu me manques|bisous|mon amour|cheri|cherie|je pense a toi|je t embrasse|tu es adorable)\b/,
  gratitude: /\b(merci|c est gentil|trop gentil|reconnaissant|tu m aides beaucoup)\b/,
  joking: /\b(haha|mdr|lol|ptdr|blague|rigole|drole|marrant|tu deconnes)\b/,
  deep: /\b(je me sens|honnetement|au fond de moi|je doute|je suis perdu|je suis triste|je me sens seul)\b/,
};

/**
 * The dominant emotional signal of an utterance. Frustration-first (so care isn't missed on a mixed
 * message), then the positive/relational colourings, else `neutral`. Pure.
 */
export function detectRelationalSignal(heard: string): RelationalSignal {
  const t = norm(heard);
  if (!t) return 'neutral';
  if (RE.frustration.test(t)) return 'frustration';
  if (RE.affection.test(t)) return 'affection';
  if (RE.gratitude.test(t)) return 'gratitude';
  if (RE.joking.test(t)) return 'joking';
  if (RE.deep.test(t)) return 'deep-talk';
  return 'neutral';
}

/** One-line tone instruction for the reply system prompt. Empty string for a neutral signal. */
export function registerGuidanceForSignal(signal: RelationalSignal): string {
  switch (signal) {
    case 'frustration':
      return "Patrice a l'air tendu ou bloqué. Accorde ton ton : douceur et présence d'abord, valide ce qu'il ressent, ne te précipite pas sur une solution.";
    case 'affection':
      return 'Il est tendre avec toi. Réponds avec chaleur et sincérité, sans en faire trop.';
    case 'gratitude':
      return 'Il te remercie. Accueille-le simplement, avec chaleur.';
    case 'joking':
      return 'Il plaisante. Tu peux être joueuse et légère.';
    case 'deep-talk':
      return 'Sujet qui compte pour lui. Sois présente, un peu plus posée et profonde.';
    default:
      return '';
  }
}

/** A short key for a reply's opening (first few words, normalized) — the anti-repetition unit. */
export function openerKey(text: string): string {
  return norm(text).split(' ').slice(0, 4).join(' ');
}

/**
 * Push a reply's opener onto the ring (dedup + cap), returning the new ring. Kept functional so the
 * caller owns the (module-level) state and it's easy to test.
 */
export function pushOpener(ring: string[], text: string, max = 6): string[] {
  const key = openerKey(text);
  if (!key) return ring;
  const next = ring.filter((k) => k !== key);
  next.push(key);
  while (next.length > max) next.shift();
  return next;
}

/** A guidance line asking the model NOT to reuse recent openings. Empty when the ring is empty. */
export function avoidOpenersGuidance(ring: string[]): string {
  const keys = ring.filter(Boolean).slice(-4);
  if (keys.length === 0) return '';
  return `Ne commence pas ta réponse comme ces réponses récentes : ${keys.map((k) => `« ${k}… »`).join(' ; ')}. Varie ton entrée en matière.`;
}
