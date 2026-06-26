/**
 * `buddy council "<task>"` — capability-aware multi-LLM router + ensemble + learning.
 *
 * Flow (most pieces already exist in the Fleet; this orchestrates them and adds
 * the learning layer):
 *  1. List usable LLMs            → buildActiveLlmRegistry (providers/active-llm-registry)
 *  2. Route by capability         → strengths heuristic × (1 + historical win rate)
 *  3. Ask several in parallel     → createParallelExecutor (agent/parallel) 'ensemble'
 *  4. Judge → keep the best       → an impartial LLM scores anonymized, shuffled answers
 *  5. Consensus on divergence     → computeTextConsensus (fleet/result-aggregator)
 *  6. Learn / prefer the best     → ModelScoreboard records every outcome
 */

import { CodeBuddyClient } from '../codebuddy/client.js';
import { computeTextConsensus, type ConsensusSource } from '../fleet/result-aggregator.js';
import { getModelScoreboard } from '../fleet/model-scoreboard.js';
import { inferStrengths, inferTaskType } from '../fleet/model-capability-heuristics.js';
import type { ModelStrength } from '../fleet/types.js';

export interface CouncilOptions {
  /** How many models to consult (default 3). */
  count?: number;
  /** Comma list of provider/model substrings to restrict candidates. */
  models?: string;
  /** Provider/model substring to use as the judge (default: a neutral strong model). */
  judge?: string;
  /** Override the inferred task type. */
  taskType?: string;
  /** commander sets this false on --no-consensus. */
  consensus?: boolean;
  /** Just print the learned scoreboard and exit. */
  scoreboard?: boolean;
}

type Emit = (s: string) => void;

/** Per-model wall-clock cap so a slow model never blocks the council. */
const COUNCIL_TIMEOUT_MS = Number(process.env.CODEBUDDY_COUNCIL_TIMEOUT_MS) || 45000;

// --- capability heuristics (inferStrengths / inferTaskType shared with the
//     latency-aware selector; see fleet/model-capability-heuristics.ts) ---

const TASK_REQUIRES: Record<string, ModelStrength[]> = {
  code: ['code', 'reasoning'],
  reasoning: ['reasoning', 'thinking'],
  french: ['french', 'reasoning'],
  vision: ['vision'],
  general: ['reasoning', 'fast'],
};

function matchScore(strengths: ModelStrength[], required: ModelStrength[]): number {
  if (required.length === 0) return 0.5;
  const have = new Set(strengths);
  const hits = required.filter((r) => have.has(r)).length;
  return hits / required.length;
}

interface RankedCandidate {
  c: { provider: string; model: string; apiKey?: string; baseURL?: string; costInputUsdPerMtok: number };
  strengths: ModelStrength[];
  score: number;
  hist: number;
}

/** Pick top-K, favouring distinct providers for genuine diversity. */
function pickDiverse(ranked: RankedCandidate[], k: number): RankedCandidate[] {
  const picked: RankedCandidate[] = [];
  const seen = new Set<string>();
  for (const r of ranked) {
    if (picked.length >= k) break;
    if (seen.has(r.c.provider)) continue;
    seen.add(r.c.provider);
    picked.push(r);
  }
  for (const r of ranked) {
    if (picked.length >= k) break;
    if (!picked.includes(r)) picked.push(r);
  }
  return picked;
}

// --- judge ---

interface JudgeJson {
  scores?: Record<string, number>;
  winner?: string;
  why?: string;
}

function extractJson(text: string): JudgeJson | null {
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

interface Verdict {
  winnerIdx: number;
  scores: number[];
  rationale: string;
}

async function judgeAnswers(
  client: CodeBuddyClient,
  task: string,
  answers: { modelName: string; content: string }[],
): Promise<Verdict> {
  const scores = new Array(answers.length).fill(0);
  // Shuffle to neutralise position bias; answers are already identity-blind.
  const order = answers.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const letters = order.map((_, i) => String.fromCharCode(65 + i));
  const blocks = order
    .map((origIdx, pos) => `### Réponse ${letters[pos]}\n${answers[origIdx]!.content.trim()}`)
    .join('\n\n');

  const sys =
    'You are an impartial judge. You receive a task and several ANONYMOUS candidate answers ' +
    '(A, B, C…). Score each from 0.0 to 1.0 on correctness, completeness and usefulness, then ' +
    'pick the single best. Judge ONLY the content — you do not know which model wrote which. ' +
    'Respond with STRICT JSON and nothing else: {"scores":{"A":0.0},"winner":"A","why":"one short sentence"}.';
  const user = `TASK:\n${task}\n\nCANDIDATE ANSWERS:\n${blocks}\n\nReturn the JSON now.`;

  let winnerIdx = 0;
  let rationale = '';
  try {
    const resp = await Promise.race([
      client.chat(
        [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        [],
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`judge timeout >${Math.round(COUNCIL_TIMEOUT_MS / 1000)}s`)), COUNCIL_TIMEOUT_MS),
      ),
    ]);
    const text = resp?.choices?.[0]?.message?.content ?? '';
    const json = extractJson(text);
    if (json) {
      for (let pos = 0; pos < order.length; pos++) {
        const sc = Number(json.scores?.[letters[pos]!]);
        if (Number.isFinite(sc)) scores[order[pos]!] = Math.max(0, Math.min(1, sc));
      }
      const winLetter = String(json.winner ?? '').trim().toUpperCase().charAt(0);
      const winPos = letters.indexOf(winLetter);
      winnerIdx = winPos >= 0 ? order[winPos]! : scores.indexOf(Math.max(...scores));
      rationale = String(json.why ?? '').trim();
    } else {
      winnerIdx = answers.reduce((b, a, i) => (a.content.length > answers[b]!.content.length ? i : b), 0);
      rationale = '(juge: réponse non-JSON → choix par longueur)';
    }
  } catch (err) {
    winnerIdx = 0;
    rationale = `(juge indisponible: ${err instanceof Error ? err.message : String(err)})`;
  }
  if (!(scores[winnerIdx]! > 0)) scores[winnerIdx] = 1;
  return { winnerIdx, scores, rationale };
}

function buildJudgeClient(
  picked: RankedCandidate[],
  all: RankedCandidate['c'][],
  judgePref?: string,
): CodeBuddyClient | null {
  const pickedModels = new Set(picked.map((p) => p.c.model));
  let judge: RankedCandidate['c'] | undefined;
  if (judgePref) {
    const want = judgePref.toLowerCase();
    judge = all.find(
      (c) => c.provider.toLowerCase().includes(want) || c.model.toLowerCase().includes(want),
    );
  }
  // Prefer a strong reasoning model that is NOT one of the candidates (neutral).
  if (!judge) {
    judge = all.find(
      (c) => !pickedModels.has(c.model) && /gpt-5|opus|sonnet|gemini|grok-[34]|grok-4|o3|reason/.test(c.model.toLowerCase()),
    );
  }
  if (!judge) judge = picked[0]?.c;
  if (!judge || !judge.apiKey) return null;
  try {
    return new CodeBuddyClient(judge.apiKey, judge.model, judge.baseURL);
  } catch {
    return null;
  }
}

// --- main ---

export async function runCouncil(task: string, opts: CouncilOptions, out: Emit): Promise<void> {
  const scoreboard = getModelScoreboard();

  if (opts.scoreboard) {
    out(scoreboard.print(opts.taskType));
    return;
  }
  if (!task || !task.trim()) {
    out('Usage: buddy council "<task>"   (or --scoreboard to see what it has learned)');
    return;
  }

  const { buildActiveLlmRegistry } = await import('../providers/active-llm-registry.js');
  const registry = await buildActiveLlmRegistry({});
  let candidates = registry.all.filter((c) => c.apiKey);
  if (candidates.length === 0) {
    out('No active LLMs detected. Run `buddy login`, set an API key, or start Ollama.');
    return;
  }

  if (opts.models) {
    const wanted = opts.models.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const filtered = candidates.filter((c) =>
      wanted.some((w) => c.provider.toLowerCase().includes(w) || c.model.toLowerCase().includes(w)),
    );
    if (filtered.length) candidates = filtered;
  }

  const taskType = (opts.taskType || inferTaskType(task)).toLowerCase();
  const required = TASK_REQUIRES[taskType] ?? TASK_REQUIRES.general!;

  const ranked: RankedCandidate[] = candidates
    .map((c) => {
      const strengths = inferStrengths(c.model);
      const cap = matchScore(strengths, required);
      const hist = scoreboard.winRate(taskType, c.model);
      const cheapBonus = c.costInputUsdPerMtok === 0 ? 0.05 : 0;
      return { c, strengths, score: (cap + 0.1 + cheapBonus) * (1 + hist), hist };
    })
    .sort((a, b) => b.score - a.score);

  const k = Math.max(1, Math.min(opts.count ?? 3, ranked.length));
  const picked = pickDiverse(ranked, k);

  out(
    `🧠 Council — tâche "${taskType}" → ${picked.length} IA : ` +
      picked.map((p) => `${p.c.model}${p.hist > 0 ? ` (${Math.round(p.hist * 100)}% hist)` : ''}`).join(', '),
  );

  // Direct fan-out with a per-model timeout so one slow model (e.g. a big local
  // CPU model) can never block the whole council. allSettled never rejects;
  // timed-out / failed models are simply dropped from the panel.
  type Answer = { modelId: string; modelName: string; content: string; latency: number; tokensUsed: number; cost: number };
  const settled = await Promise.allSettled(
    picked.map(async (p): Promise<Answer> => {
      const client = new CodeBuddyClient(p.c.apiKey ?? '', p.c.model, p.c.baseURL);
      const t0 = Date.now();
      const resp = await Promise.race([
        client.chat([{ role: 'user', content: task }], []),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`timeout >${Math.round(COUNCIL_TIMEOUT_MS / 1000)}s`)), COUNCIL_TIMEOUT_MS),
        ),
      ]);
      const content = resp?.choices?.[0]?.message?.content ?? '';
      if (!content.trim()) throw new Error('réponse vide');
      const usage = resp?.usage;
      return {
        modelId: p.c.provider,
        modelName: p.c.model,
        content,
        latency: Date.now() - t0,
        tokensUsed: usage?.total_tokens ?? 0,
        cost: ((usage?.prompt_tokens ?? 0) / 1_000_000) * p.c.costInputUsdPerMtok,
      };
    }),
  );
  const answers: Answer[] = settled
    .filter((s): s is PromiseFulfilledResult<Answer> => s.status === 'fulfilled')
    .map((s) => s.value);
  settled.forEach((s, i) => {
    if (s.status === 'rejected') {
      const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
      out(`  ⚠️ ${picked[i]!.c.model}: ${reason.slice(0, 120)}`);
    }
  });

  if (answers.length === 0) {
    out('❌ Toutes les IA ont échoué.');
    return;
  }

  const judgeClient = buildJudgeClient(picked, candidates, opts.judge);
  const verdict = judgeClient
    ? await judgeAnswers(judgeClient, task, answers)
    : {
        winnerIdx: answers.reduce((b, a, i) => (a.content.length > answers[b]!.content.length ? i : b), 0),
        scores: answers.map(() => 0.5),
        rationale: '(aucun juge disponible)',
      };

  const sources: ConsensusSource[] = answers.map((a) => ({ peerId: a.modelId, model: a.modelName, text: a.content }));
  const consensus = computeTextConsensus(sources);

  // Learn: record every model's outcome for this task type.
  const at = new Date().toISOString();
  for (let i = 0; i < answers.length; i++) {
    const provider = picked.find((p) => p.c.model === answers[i]!.modelName)?.c.provider ?? answers[i]!.modelId;
    scoreboard.recordOutcome({
      at,
      taskType,
      model: answers[i]!.modelName,
      provider,
      won: i === verdict.winnerIdx,
      quality: verdict.scores[i] ?? 0,
      latencyMs: answers[i]!.latency,
      costUsd: answers[i]!.cost ?? 0,
    });
  }

  const winner = answers[verdict.winnerIdx]!;
  out(`\n🏆 Meilleure réponse — ${winner.modelName}${verdict.rationale ? ` : ${verdict.rationale}` : ''}\n`);
  out(winner.content.trim());

  if (opts.consensus !== false && answers.length > 1) {
    const pct = Math.round(consensus.score * 100);
    // Jaccard word-overlap on free-form prose is informational, NOT a verdict:
    // two good answers phrased differently legitimately score low. The judge
    // above is the real quality evaluator; this just flags how lexically close
    // the wordings were (high overlap ⇒ the models genuinely converged).
    out(`\n🤝 Accord lexical inter-IA : ${pct}% (recouvrement de mots — le juge ci-dessus évalue le fond).`);
  }

  out('\n📊 Détail par IA :');
  for (let i = 0; i < answers.length; i++) {
    const mark = i === verdict.winnerIdx ? '🏆' : '  ';
    out(
      `${mark} ${answers[i]!.modelName.padEnd(22)} score ${(verdict.scores[i] ?? 0).toFixed(2)}  ` +
        `${answers[i]!.latency}ms  ${answers[i]!.tokensUsed} tok`,
    );
  }

  out(`\n${scoreboard.print(taskType)}`);
}
