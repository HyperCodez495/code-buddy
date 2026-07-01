/**
 * Council judge — scores anonymised, shuffled answers and picks a winner.
 *
 * Hardened against the biases that used to corrupt the learning layer:
 *  - No fallback winner. A non-JSON reply, a timeout or an unusable verdict
 *    → `kind: 'abstained'` (the old code picked the LONGEST answer on
 *    non-JSON and index 0 on error — both trained the scoreboard wrong).
 *  - No fabricated scores: a winner with score 0 keeps score 0; the margin
 *    signal downstream will honestly report low confidence.
 *  - Neutrality is tracked: a judge drawn from the panel judges its own work,
 *    so its verdict is display-only (`neutral: false` → never learnable).
 *  - Candidate answers are truncated before judging: context overflow on
 *    small local judges was the main trigger of the old biased fallback.
 *
 * @module council/judge
 */

import type { CouncilCandidate, CouncilChatClient, JudgeVerdict } from './types.js';
import { withTimeout } from './with-timeout.js';

const JUDGE_MAX_CHARS_PER_ANSWER = 6000;

/** Models considered strong enough to judge (name heuristic, same family as inferStrengths). */
const STRONG_JUDGE_PATTERN = /gpt-5|opus|sonnet|fable|gemini|grok-[34]|grok-4|o3|reason/;

interface JudgeJson {
  scores?: Record<string, number>;
  winner?: string;
  why?: string;
}

export function extractJson(text: string): JudgeJson | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as JudgeJson;
  } catch {
    /* not pure JSON */
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]) as JudgeJson;
    } catch {
      /* salvage failed */
    }
  }
  return null;
}

export interface JudgeSelection {
  candidate: CouncilCandidate;
  /** True when the judge is NOT one of the panel members. */
  neutral: boolean;
}

/**
 * Pick a judge. An explicit `judgePref` is honoured even if it lands on a
 * panel member (the user asked for it), but neutrality is reported honestly.
 * Without a preference, only a strong model OUTSIDE the panel qualifies —
 * returns null when none exists (the engine may then use a panel member for
 * display, flagged non-neutral so the verdict never trains the scoreboard).
 */
export function selectNeutralJudge(
  all: readonly CouncilCandidate[],
  pickedModels: ReadonlySet<string>,
  judgePref?: string,
): JudgeSelection | null {
  if (judgePref) {
    const want = judgePref.toLowerCase();
    const judge = all.find(
      (c) => c.apiKey && (c.provider.toLowerCase().includes(want) || c.model.toLowerCase().includes(want)),
    );
    if (judge) return { candidate: judge, neutral: !pickedModels.has(judge.model) };
  }
  const neutral = all.find(
    (c) => c.apiKey && !pickedModels.has(c.model) && STRONG_JUDGE_PATTERN.test(c.model.toLowerCase()),
  );
  return neutral ? { candidate: neutral, neutral: true } : null;
}

export interface JudgeConfig {
  timeoutMs: number;
  judgeModel: string;
  neutral: boolean;
  /** Per-answer character cap in the judge prompt (default 6000). */
  maxCharsPerAnswer?: number;
}

function truncateAnswer(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trim()}\n...[truncated for judging]`;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export async function judgeAnswers(
  client: CouncilChatClient,
  task: string,
  answers: ReadonlyArray<{ content: string }>,
  config: JudgeConfig,
  rng: () => number = Math.random,
): Promise<JudgeVerdict> {
  const abstain = (rationale: string): JudgeVerdict => ({
    kind: 'abstained',
    winnerIdx: null,
    scores: answers.map(() => 0),
    rationale,
    judgeModel: config.judgeModel,
    neutral: config.neutral,
  });

  const maxChars = config.maxCharsPerAnswer ?? JUDGE_MAX_CHARS_PER_ANSWER;
  const scores = answers.map(() => 0);
  // Shuffle to neutralise position bias; answers are already identity-blind.
  const order = answers.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const letters = order.map((_, i) => String.fromCharCode(65 + i));
  const blocks = order
    .map((origIdx, pos) => `### Réponse ${letters[pos]}\n${truncateAnswer(answers[origIdx]!.content, maxChars)}`)
    .join('\n\n');

  const sys =
    'You are an impartial judge. You receive a task and several ANONYMOUS candidate answers ' +
    '(A, B, C…). Score each from 0.0 to 1.0 on correctness, completeness and usefulness, then ' +
    'pick the single best. Judge ONLY the content — you do not know which model wrote which. ' +
    'Respond with STRICT JSON and nothing else: {"scores":{"A":0.0},"winner":"A","why":"one short sentence"}.';
  const user = `TASK:\n${task}\n\nCANDIDATE ANSWERS:\n${blocks}\n\nReturn the JSON now.`;

  try {
    const resp = await withTimeout(
      client.chat([
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ]),
      config.timeoutMs,
      'judge',
    );
    const json = extractJson(resp.content);
    if (!json) return abstain('(juge: réponse non-JSON → abstention, aucun gagnant fiable)');

    for (let pos = 0; pos < order.length; pos++) {
      const sc = Number(json.scores?.[letters[pos]!]);
      if (Number.isFinite(sc)) scores[order[pos]!] = clamp01(sc);
    }
    const winLetter = String(json.winner ?? '').trim().toUpperCase().charAt(0);
    const winPos = letters.indexOf(winLetter);
    let winnerIdx = winPos >= 0 ? order[winPos]! : -1;
    if (winnerIdx < 0) {
      const best = Math.max(...scores);
      winnerIdx = best > 0 ? scores.indexOf(best) : -1;
    }
    if (winnerIdx < 0) return abstain('(juge: JSON sans winner ni scores exploitables → abstention)');

    return {
      kind: 'judged',
      winnerIdx,
      scores,
      rationale: String(json.why ?? '').trim(),
      judgeModel: config.judgeModel,
      neutral: config.neutral,
    };
  } catch (err) {
    return abstain(`(juge indisponible: ${err instanceof Error ? err.message : String(err)})`);
  }
}
