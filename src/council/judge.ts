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
 *  - DUAL scores: `task` (did it answer the user's task — picks the winner)
 *    and `role` (did it hold its announced council role — trains role
 *    routing). A critic doing its job used to score 0.25 "for refusing to
 *    decide" and the scoreboard learned that; role scores fix the reward.
 *  - Verbosity is explicitly NOT a criterion, and the judge must VERIFY what
 *    is verifiable (counts, computations) before scoring.
 *  - Dead judges are excluded: `selectNeutralJudge` skips models whose recent
 *    council history is consecutive failures (a retired catalog model used to
 *    be re-picked as judge forever, aborting every deliberation).
 *
 * @module council/judge
 */

import type { CouncilCandidate, CouncilChatClient, JudgeVerdict } from './types.js';
import { withTimeout } from './with-timeout.js';
import { extractJsonObject } from '../utils/json-salvage.js';

const JUDGE_MAX_CHARS_PER_ANSWER = 6000;

/** Models considered strong enough to judge (name heuristic, same family as inferStrengths). */
const STRONG_JUDGE_PATTERN = /gpt-5|opus|sonnet|fable|gemini|grok-[34]|grok-4|o3|reason/;

/** Trailing consecutive failures after which a model is considered dead for judging. */
const JUDGE_DEAD_AFTER_FAILURES = 2;

interface JudgeJsonScores {
  [letter: string]: number | { task?: number; role?: number };
}

interface JudgeJson {
  scores?: JudgeJsonScores;
  winner?: string;
  why?: string;
  verified?: string;
}

export function extractJson(text: string): JudgeJson | null {
  return extractJsonObject<JudgeJson>(text);
}

export interface JudgeSelection {
  candidate: CouncilCandidate;
  /** True when the judge is NOT one of the panel members. */
  neutral: boolean;
}

/** Read-only slice of the scoreboard the judge selection needs. */
export interface JudgeFailureHistory {
  consecutiveRecentFailures(model: string): number;
}

/**
 * Pick a judge. An explicit `judgePref` is honoured even if it lands on a
 * panel member (the user asked for it), but neutrality is reported honestly.
 * Without a preference, only a strong model OUTSIDE the panel — and without a
 * trailing run of recorded failures — qualifies. Returns null when none
 * exists (the engine may then use a panel member for display, flagged
 * non-neutral so the verdict never trains the scoreboard).
 */
export function selectNeutralJudge(
  all: readonly CouncilCandidate[],
  pickedModels: ReadonlySet<string>,
  judgePref?: string,
  failureHistory?: JudgeFailureHistory,
): JudgeSelection | null {
  const isDead = (model: string): boolean =>
    (failureHistory?.consecutiveRecentFailures(model) ?? 0) >= JUDGE_DEAD_AFTER_FAILURES;

  if (judgePref) {
    const want = judgePref.toLowerCase();
    const judge = all.find(
      (c) => c.apiKey && (c.provider.toLowerCase().includes(want) || c.model.toLowerCase().includes(want)),
    );
    if (judge) return { candidate: judge, neutral: !pickedModels.has(judge.model) };
  }
  const neutral = all.find(
    (c) =>
      c.apiKey &&
      !pickedModels.has(c.model) &&
      STRONG_JUDGE_PATTERN.test(c.model.toLowerCase()) &&
      !isDead(c.model),
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

/** Old single-number format tolerated: task = role = the number. */
function normalizeScoreEntry(raw: number | { task?: number; role?: number } | undefined): {
  task: number | null;
  role: number | null;
} {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { task: clamp01(raw), role: clamp01(raw) };
  }
  if (raw && typeof raw === 'object') {
    const task = Number(raw.task);
    const role = Number(raw.role);
    return {
      task: Number.isFinite(task) ? clamp01(task) : null,
      role: Number.isFinite(role) ? clamp01(role) : Number.isFinite(task) ? clamp01(task) : null,
    };
  }
  return { task: null, role: null };
}

export async function judgeAnswers(
  client: CouncilChatClient,
  task: string,
  answers: ReadonlyArray<{ content: string; roleLabel?: string }>,
  config: JudgeConfig,
  rng: () => number = Math.random,
): Promise<JudgeVerdict> {
  const abstain = (rationale: string, judgeCallFailed = false): JudgeVerdict => ({
    kind: 'abstained',
    winnerIdx: null,
    scores: answers.map(() => 0),
    roleScores: answers.map(() => 0),
    rationale,
    verified: '',
    judgeModel: config.judgeModel,
    neutral: config.neutral,
    ...(judgeCallFailed ? { judgeCallFailed: true } : {}),
  });

  const maxChars = config.maxCharsPerAnswer ?? JUDGE_MAX_CHARS_PER_ANSWER;
  const scores = answers.map(() => 0);
  const roleScores = answers.map(() => 0);
  // Shuffle to neutralise position bias; answers are identity-blind (the
  // ROLE is disclosed — it is needed for role-fit scoring and reveals no
  // model identity).
  const order = answers.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const letters = order.map((_, i) => String.fromCharCode(65 + i));
  const blocks = order
    .map((origIdx, pos) => {
      const role = answers[origIdx]!.roleLabel;
      const header = role ? `### Réponse ${letters[pos]} — rôle annoncé: ${role}` : `### Réponse ${letters[pos]}`;
      return `${header}\n${truncateAnswer(answers[origIdx]!.content, maxChars)}`;
    })
    .join('\n\n');

  const sys =
    'You are the impartial judge of Code Buddy Council. You receive a task and several ' +
    'ANONYMOUS candidate answers (A, B, C…), each possibly tagged with its council role. ' +
    'For EACH answer give TWO scores from 0.0 to 1.0: ' +
    '"task" = does it answer the user task correctly and usefully? ' +
    '"role" = did it hold its announced role (a critic exposing precise breaking ' +
    'conditions holds its role, even without a full direct answer)? ' +
    'Rules: Length is NOT a criterion — a short correct answer beats a long correct one; ' +
    'penalise filler. If a point is verifiable by you (a count, a computation, a fact), ' +
    'VERIFY it yourself before scoring and report what you checked in "verified". ' +
    'The winner is the best answer for the TASK; role scores feed learning, not the win. ' +
    'Judge ONLY the content — you do not know which model wrote which. ' +
    'Respond with STRICT JSON and nothing else: ' +
    '{"scores":{"A":{"task":0.0,"role":0.0}},"winner":"A","verified":"what you re-checked yourself, or empty","why":"one short sentence"}.';
  const user = `TASK:\n${task}\n\nCANDIDATE ANSWERS:\n${blocks}\n\nReturn the JSON now.`;

  let resp: { content: string };
  try {
    resp = await withTimeout(
      client.chat([
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ]),
      config.timeoutMs,
      'judge',
    );
  } catch (err) {
    return abstain(`(juge indisponible: ${err instanceof Error ? err.message : String(err)})`, true);
  }

  const json = extractJson(resp.content);
  if (!json) return abstain('(juge: réponse non-JSON → abstention, aucun gagnant fiable)');

  for (let pos = 0; pos < order.length; pos++) {
    const entry = normalizeScoreEntry(json.scores?.[letters[pos]!]);
    if (entry.task !== null) scores[order[pos]!] = entry.task;
    if (entry.role !== null) roleScores[order[pos]!] = entry.role;
  }
  // Extract the winner letter robustly. A bare "A" is the common case, but a
  // judge (especially a small local one) that replies "Answer B" would, with a
  // naive charAt(0), be read as 'A' (first char of "ANSWER") and MIS-ROUTE the
  // win. Prefer an exact single-letter reply, else the earliest standalone
  // option letter actually mentioned.
  const winRaw = String(json.winner ?? '').trim().toUpperCase();
  let winLetter = letters.includes(winRaw) ? winRaw : '';
  if (!winLetter) {
    let bestPos = Infinity;
    for (const letter of letters) {
      const idx = winRaw.search(new RegExp(`\\b${letter}\\b`));
      if (idx >= 0 && idx < bestPos) {
        bestPos = idx;
        winLetter = letter;
      }
    }
  }
  const winPos = winLetter ? letters.indexOf(winLetter) : -1;
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
    roleScores,
    rationale: String(json.why ?? '').trim(),
    verified: String(json.verified ?? '').trim(),
    judgeModel: config.judgeModel,
    neutral: config.neutral,
  };
}
