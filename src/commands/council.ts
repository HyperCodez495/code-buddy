/**
 * `buddy council "<task>"` — capability-aware multi-LLM router + ensemble + learning.
 *
 * Flow (most pieces already exist in the Fleet; this orchestrates them and adds
 * the learning layer):
 *  1. List usable LLMs            → buildActiveLlmRegistry (providers/active-llm-registry)
 *  2. Route by capability         → strengths heuristic × (1 + historical win rate)
 *  3. Conductor roles             → ask complementary roles, not N copies of the same prompt
 *  4. Ask several in parallel     → direct chat calls with per-model timeouts
 *  5. Judge → keep the best       → an impartial LLM scores anonymized, shuffled answers
 *  6. Synthesize collective view  → merge complementary roles when conductor mode is active
 *  7. Consensus on divergence     → computeTextConsensus (fleet/result-aggregator)
 *  8. Learn / prefer the best     → ModelScoreboard records every outcome
 */

import { CodeBuddyClient } from '../codebuddy/client.js';
import { computeTextConsensus, type ConsensusSource } from '../fleet/result-aggregator.js';
import { getModelScoreboard, type ModelScoreboard } from '../fleet/model-scoreboard.js';
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
  /** Also consult connected fleet peers (other machines' Code Buddy) via peer.chat. */
  fleet?: boolean;
  /** Use adaptive conductor roles instead of asking every model the exact same prompt. Default true. */
  conductor?: boolean;
  /** Use a final synthesis pass for collective conductor runs. Default true. */
  synthesis?: boolean;
  /** Inject peer connections (tests/scripts); else read getFleetRegistry().list(). */
  fleetPeers?: CouncilPeer[];
  /** Per-peer timeout for the fleet round-trip (default = COUNCIL_TIMEOUT_MS). */
  peerTimeoutMs?: number;
}

type Emit = (s: string) => void;

/** Per-model wall-clock cap so a slow model never blocks the council. */
const COUNCIL_TIMEOUT_MS = Number(process.env.CODEBUDDY_COUNCIL_TIMEOUT_MS) || 45000;

// --- fleet: consult other machines' Code Buddy over the WS mesh ---

export interface PeerAnswer {
  modelId: string;
  modelName: string;
  content: string;
  latency: number;
  tokensUsed: number;
  cost: number;
  role?: CouncilRole;
}
export interface CouncilPeer {
  id: string;
  listener: {
    request: (method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }) => Promise<unknown>;
  };
}

export interface GatherPeerAnswersOptions {
  promptForPeer?: (peer: CouncilPeer, index: number) => string;
  roleForPeer?: (peer: CouncilPeer, index: number) => CouncilRole | undefined;
}

/**
 * Ask each connected fleet peer via `peer.chat` (parallel, per-peer timeout). The caller may
 * specialize each prompt with a conductor role. A slow/absent/failing peer is dropped into
 * `errors` — never crashing the council. The returned answers are structurally the council's own
 * Answer shape, so they fold into the SAME judged set.
 */
export async function gatherPeerAnswers(
  task: string,
  peers: CouncilPeer[],
  timeoutMs: number,
  options: GatherPeerAnswersOptions = {},
): Promise<{ answers: PeerAnswer[]; errors: Array<{ id: string; message: string }> }> {
  const settled = await Promise.allSettled(
    peers.map(async (p, index): Promise<PeerAnswer> => {
      const t0 = Date.now();
      const prompt = options.promptForPeer?.(p, index) ?? task;
      const resp = (await p.listener.request('peer.chat', { prompt }, { timeoutMs })) as {
        text?: string;
        modelRequested?: string;
        usage?: { total_tokens?: number };
      };
      const content = (resp?.text ?? '').trim();
      if (!content) throw new Error('réponse vide');
      return {
        modelId: p.id,
        modelName: `${p.id}:${resp.modelRequested ?? 'peer'}`,
        content,
        latency: Date.now() - t0,
        tokensUsed: resp.usage?.total_tokens ?? 0,
        cost: 0, // peers are your own machines → $0 marginal
        role: options.roleForPeer?.(p, index),
      };
    }),
  );
  const answers: PeerAnswer[] = [];
  const errors: Array<{ id: string; message: string }> = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') answers.push(s.value);
    else errors.push({ id: peers[i]!.id, message: s.reason instanceof Error ? s.reason.message : String(s.reason) });
  });
  return { answers, errors };
}

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

export interface RankedCandidate {
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

export function assignCouncilRolesToCandidates(
  picked: RankedCandidate[],
  roles: CouncilRole[],
  taskType: string,
  scoreboard: Pick<ModelScoreboard, 'roleScore'>,
): RankedCandidate[] {
  const localRoles = roles.slice(0, picked.length);
  if (picked.length < 2 || localRoles.length < 2) return picked;

  const roleScore = (ordered: RankedCandidate[]): number =>
    ordered.reduce((sum, candidate, index) => {
      const role = localRoles[index];
      return sum + (role ? scoreboard.roleScore(taskType, role.id, candidate.c.model) : 0);
    }, 0);

  let best = picked;
  let bestScore = roleScore(picked);
  if (picked.length <= 6) {
    const remaining = [...picked];
    const current: RankedCandidate[] = [];
    const visit = (): void => {
      if (current.length === picked.length) {
        const score = roleScore(current);
        if (score > bestScore + Number.EPSILON) {
          best = [...current];
          bestScore = score;
        }
        return;
      }
      for (let i = 0; i < remaining.length; i++) {
        const [candidate] = remaining.splice(i, 1);
        current.push(candidate!);
        visit();
        current.pop();
        remaining.splice(i, 0, candidate!);
      }
    };
    visit();
  } else {
    const remaining = [...picked];
    const assigned: RankedCandidate[] = [];
    for (const role of localRoles) {
      let bestIndex = 0;
      let bestCandidateScore = -1;
      for (let i = 0; i < remaining.length; i++) {
        const score = scoreboard.roleScore(taskType, role.id, remaining[i]!.c.model);
        if (score > bestCandidateScore) {
          bestIndex = i;
          bestCandidateScore = score;
        }
      }
      assigned.push(remaining.splice(bestIndex, 1)[0]!);
    }
    const assignedScore = roleScore(assigned);
    if (assignedScore > bestScore + Number.EPSILON) {
      best = assigned;
      bestScore = assignedScore;
    }
  }

  return bestScore > 0 ? best : picked;
}

// --- conductor roles ---

export interface CouncilRole {
  id: string;
  label: string;
  mission: string;
  focus: string[];
}

export interface CouncilConductorPlan {
  mode: 'direct' | 'collective';
  reason: string;
  roles: CouncilRole[];
}

const DIRECT_ROLE: CouncilRole = {
  id: 'direct',
  label: 'Direct answer',
  mission: 'Answer the user task directly with the best complete response.',
  focus: ['correctness', 'usefulness', 'clear assumptions'],
};

const ROLE_SETS: Record<string, CouncilRole[]> = {
  code: [
    {
      id: 'architect',
      label: 'Architect',
      mission: 'Design the clean technical approach before implementation.',
      focus: ['architecture', 'interfaces', 'integration risk'],
    },
    {
      id: 'implementer',
      label: 'Implementer',
      mission: 'Find the practical implementation path and concrete next edits.',
      focus: ['minimal viable changes', 'existing code patterns', 'test impact'],
    },
    {
      id: 'reviewer',
      label: 'Reviewer',
      mission: 'Attack the proposal as a code reviewer and find regressions.',
      focus: ['bugs', 'security', 'missing tests'],
    },
    {
      id: 'verifier',
      label: 'Verifier',
      mission: 'Define how to prove the answer or change is correct.',
      focus: ['test plan', 'observability', 'rollback'],
    },
  ],
  reasoning: [
    {
      id: 'strategist',
      label: 'Strategist',
      mission: 'Build the strongest high-level solution.',
      focus: ['goal decomposition', 'tradeoffs', 'decision criteria'],
    },
    {
      id: 'skeptic',
      label: 'Skeptic',
      mission: 'Look for flawed assumptions and counterexamples.',
      focus: ['failure modes', 'hidden constraints', 'overconfidence'],
    },
    {
      id: 'verifier',
      label: 'Verifier',
      mission: 'Check the reasoning and propose validation steps.',
      focus: ['evidence', 'consistency', 'what would falsify this'],
    },
  ],
  french: [
    {
      id: 'clarifier',
      label: 'Clarificateur',
      mission: 'Reformuler le besoin et proposer une réponse claire.',
      focus: ['nuance', 'structure', 'français naturel'],
    },
    {
      id: 'critique',
      label: 'Critique',
      mission: 'Repérer les ambiguïtés et les risques d’interprétation.',
      focus: ['contresens', 'hypothèses', 'points à demander'],
    },
    {
      id: 'synthesizer',
      label: 'Synthèse',
      mission: 'Produire la version finale la plus utile et concise.',
      focus: ['priorités', 'clarté', 'action suivante'],
    },
  ],
  vision: [
    {
      id: 'observer',
      label: 'Observer',
      mission: 'Extract the visual facts carefully without overclaiming.',
      focus: ['visible evidence', 'uncertainty', 'missing context'],
    },
    {
      id: 'risk-reviewer',
      label: 'Risk reviewer',
      mission: 'Challenge visual assumptions and unsafe conclusions.',
      focus: ['false positives', 'privacy', 'safety'],
    },
    {
      id: 'practical-synthesizer',
      label: 'Practical synthesizer',
      mission: 'Turn observations into an actionable answer.',
      focus: ['user goal', 'next step', 'confidence'],
    },
  ],
  general: [
    {
      id: 'strategist',
      label: 'Strategist',
      mission: 'Find the best overall answer and useful framing.',
      focus: ['user intent', 'options', 'tradeoffs'],
    },
    {
      id: 'skeptic',
      label: 'Skeptic',
      mission: 'Find what could be wrong, missing, or risky.',
      focus: ['assumptions', 'edge cases', 'cost of being wrong'],
    },
    {
      id: 'practitioner',
      label: 'Practitioner',
      mission: 'Make the answer operational and concrete.',
      focus: ['steps', 'constraints', 'what to do now'],
    },
  ],
};

function isCollectiveTask(task: string, taskType: string, count: number): boolean {
  if (count < 2) return false;
  const text = task.toLowerCase();
  if (task.length > 180) return true;
  if (taskType === 'code' || taskType === 'reasoning' || taskType === 'vision') return true;
  return /\b(audit|analyse|architecture|modernise|refactor|sécurité|security|risque|risk|compare|versus|vs|plan|stratégie|strategy|design|review|vérifie|verify|complexe|deep|fond)\b/.test(text);
}

export function buildCouncilConductorPlan(
  task: string,
  taskType: string,
  count: number,
  enabled = true,
): CouncilConductorPlan {
  if (!enabled || !isCollectiveTask(task, taskType, count)) {
    return {
      mode: 'direct',
      reason: enabled ? 'simple task: direct fan-out' : 'disabled by option',
      roles: Array.from({ length: Math.max(1, count) }, () => DIRECT_ROLE),
    };
  }

  const base = ROLE_SETS[taskType] ?? ROLE_SETS.general!;
  const roles = Array.from({ length: count }, (_, index) => {
    const role = base[index % base.length]!;
    if (index < base.length) return role;
    return {
      id: `${role.id}-${index + 1}`,
      label: `${role.label} ${index + 1}`,
      mission: role.mission,
      focus: [...role.focus, 'independent angle'],
    };
  });
  return {
    mode: 'collective',
    reason: 'complex task: complementary council roles',
    roles,
  };
}

export function buildCouncilPrompt(task: string, plan: CouncilConductorPlan, roleIndex: number): string {
  const role = plan.roles[roleIndex] ?? DIRECT_ROLE;
  if (plan.mode === 'direct' || role.id === DIRECT_ROLE.id) return task;

  return [
    `You are the ${role.label} in Code Buddy Council.`,
    role.mission,
    '',
    'Focus on:',
    ...role.focus.map((item) => `- ${item}`),
    '',
    'Original user task:',
    task,
    '',
    'Return an independent answer from this role. Be concrete. Name assumptions and risks. Do not imitate a generic consensus answer.',
  ].join('\n');
}

// --- synthesis ---

export interface CouncilSynthesisCandidate {
  modelName: string;
  roleLabel?: string;
  score: number;
  winner: boolean;
  content: string;
}

export interface CouncilSynthesisPrompt {
  system: string;
  user: string;
}

export interface CouncilDecisionSignals {
  confidence: 'high' | 'medium' | 'low';
  winnerScore: number;
  runnerUpScore: number;
  margin: number;
  consensusScore: number;
  reasons: string[];
}

function truncateForSynthesis(text: string, maxChars = 4500): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trim()}\n...[truncated for council synthesis]`;
}

function clampScore(score: number): number {
  return Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
}

export function computeCouncilDecisionSignals(
  scores: number[],
  winnerIdx: number,
  consensusScore: number,
): CouncilDecisionSignals {
  const normalized = scores.map(clampScore);
  const winnerScore = clampScore(normalized[winnerIdx] ?? Math.max(0, ...normalized));
  const runnerUpScore = Math.max(0, ...normalized.filter((_, index) => index !== winnerIdx));
  const margin = Math.max(0, winnerScore - runnerUpScore);
  const consensus = clampScore(consensusScore);
  const reasons: string[] = [];

  if (winnerScore < 0.55) reasons.push('weak winner score');
  if (margin < 0.15 && normalized.length > 1) reasons.push('narrow judge margin');
  if (consensus < 0.35 && normalized.length > 1) reasons.push('low answer agreement');

  let confidence: CouncilDecisionSignals['confidence'] = 'high';
  if (winnerScore < 0.55 || margin < 0.15 || consensus < 0.25) {
    confidence = 'low';
  } else if (winnerScore < 0.72 || margin < 0.3 || consensus < 0.45) {
    confidence = 'medium';
  }

  if (reasons.length === 0) {
    reasons.push(confidence === 'high' ? 'clear judge margin and sufficient agreement' : 'moderate judge margin or agreement');
  }
  return {
    confidence,
    winnerScore,
    runnerUpScore,
    margin,
    consensusScore: consensus,
    reasons,
  };
}

export function buildCouncilVerificationHint(signals: CouncilDecisionSignals, taskType: string): string | undefined {
  if (signals.confidence === 'high') return undefined;
  const base = signals.confidence === 'low'
    ? 'Vérification recommandée'
    : 'Vérification utile';
  if (taskType === 'code') {
    return `${base}: demander un plan de tests ciblé au Verifier ou relancer avec --fleet pour un avis machine distinct.`;
  }
  if (taskType === 'vision') {
    return `${base}: vérifier avec une autre image ou un autre angle avant d'agir.`;
  }
  return `${base}: relancer avec --fleet ou augmenter -n si la décision a un impact important.`;
}

function buildDissentNotes(
  candidates: CouncilSynthesisCandidate[],
  consensusScore?: number,
  signals?: CouncilDecisionSignals,
): string[] {
  const notes: string[] = [];
  if (typeof consensusScore === 'number' && consensusScore < 0.35 && candidates.length > 1) {
    notes.push('Low lexical agreement: preserve useful minority objections instead of flattening them.');
  }
  if (signals?.confidence === 'low') {
    notes.push('Low decision confidence: state what is solid, what remains uncertain, and what should be verified next.');
  }

  const scores = candidates.map((candidate) => candidate.score).filter((score) => Number.isFinite(score));
  if (scores.length > 1) {
    const spread = Math.max(...scores) - Math.min(...scores);
    if (spread >= 0.45) {
      notes.push('Large judge-score spread: treat weak candidates as dissent or risk signals, not equal votes.');
    }
  }

  const roleLabels = new Set(candidates.map((candidate) => candidate.roleLabel).filter(Boolean));
  if (roleLabels.size > 1) {
    notes.push('Role-specialized inputs: merge complementary strengths and call out unresolved conflicts.');
  }
  return notes;
}

export function buildCouncilSynthesisPrompt(
  task: string,
  candidates: CouncilSynthesisCandidate[],
  consensusScore?: number,
  signals?: CouncilDecisionSignals,
): CouncilSynthesisPrompt {
  const blocks = candidates
    .map((candidate, index) => {
      const letter = String.fromCharCode(65 + index);
      const role = candidate.roleLabel ? ` / role: ${candidate.roleLabel}` : '';
      const winner = candidate.winner ? ' / judge reference winner' : '';
      return [
        `### Candidate ${letter}${role}${winner} / score ${candidate.score.toFixed(2)}`,
        truncateForSynthesis(candidate.content),
      ].join('\n');
    })
    .join('\n\n');

  const consensus =
    typeof consensusScore === 'number'
      ? `\nLexical agreement signal: ${Math.round(consensusScore * 100)}%. Treat this as a weak signal only.`
      : '';
  const confidence = signals
    ? `\nDecision confidence: ${signals.confidence} (winner ${signals.winnerScore.toFixed(2)}, runner-up ${signals.runnerUpScore.toFixed(2)}, margin ${signals.margin.toFixed(2)}). Reasons: ${signals.reasons.join('; ')}.`
    : '';
  const dissentNotes = buildDissentNotes(candidates, consensusScore, signals);
  const dissent =
    dissentNotes.length > 0
      ? `\nDissent handling:\n${dissentNotes.map((note) => `- ${note}`).join('\n')}`
      : '';

  return {
    system:
      'You are Code Buddy Council synthesizer. Merge a set of role-specialized answers into one stronger answer. ' +
      'Do not average weak points. Keep the best concrete recommendations, resolve contradictions, name assumptions ' +
      'and risks, and preserve useful dissent. Return the final answer only.',
    user: `Original user task:\n${task}\n${consensus}${confidence}${dissent}\n\nCouncil answers:\n${blocks}\n\nWrite the best synthesized answer now.`,
  };
}

async function synthesizeCouncilAnswer(
  client: CodeBuddyClient,
  task: string,
  candidates: CouncilSynthesisCandidate[],
  consensusScore: number,
  signals: CouncilDecisionSignals,
): Promise<string | null> {
  try {
    const prompt = buildCouncilSynthesisPrompt(task, candidates, consensusScore, signals);
    const resp = await Promise.race([
      client.chat(
        [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        [],
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`synthesis timeout >${Math.round(COUNCIL_TIMEOUT_MS / 1000)}s`)), COUNCIL_TIMEOUT_MS),
      ),
    ]);
    const text = resp?.choices?.[0]?.message?.content?.trim() ?? '';
    return text || null;
  } catch {
    return null;
  }
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
  learnable: boolean;
}

export function shouldRecordCouncilLearning(
  verdictLearnable: boolean,
  confidence: CouncilDecisionSignals['confidence'],
): boolean {
  return verdictLearnable && confidence !== 'low';
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
  let learnable = false;
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
      learnable = true;
    } else {
      winnerIdx = answers.reduce((b, a, i) => (a.content.length > answers[b]!.content.length ? i : b), 0);
      rationale = '(juge: réponse non-JSON → choix par longueur)';
    }
  } catch (err) {
    winnerIdx = 0;
    rationale = `(juge indisponible: ${err instanceof Error ? err.message : String(err)})`;
  }
  if (!(scores[winnerIdx]! > 0)) scores[winnerIdx] = 1;
  return { winnerIdx, scores, rationale, learnable };
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
  let picked = pickDiverse(ranked, k);

  let fleetPeersForCouncil: CouncilPeer[] = [];
  if (opts.fleet) {
    if (opts.fleetPeers) {
      fleetPeersForCouncil = opts.fleetPeers;
    } else {
      try {
        const { getFleetRegistry } = await import('../fleet/fleet-registry.js');
        fleetPeersForCouncil = getFleetRegistry().list().map((e) => ({ id: e.id, listener: e.listener }));
      } catch {
        fleetPeersForCouncil = [];
      }
    }
  }

  const conductorPlan = buildCouncilConductorPlan(
    task,
    taskType,
    picked.length + fleetPeersForCouncil.length,
    opts.conductor !== false,
  );
  picked = assignCouncilRolesToCandidates(picked, conductorPlan.roles, taskType, scoreboard);

  const panelSize =
    fleetPeersForCouncil.length > 0
      ? `${picked.length} locale(s) + ${fleetPeersForCouncil.length} pair(s)`
      : `${picked.length}`;
  out(
    `🧠 Council — tâche "${taskType}" → ${panelSize} IA : ` +
      picked.map((p) => `${p.c.model}${p.hist > 0 ? ` (${Math.round(p.hist * 100)}% hist)` : ''}`).join(', '),
  );
  if (conductorPlan.mode === 'collective') {
    out(`🧭 Conductor — ${conductorPlan.roles.map((role) => role.label).join(' · ')}`);
  }

  // Direct fan-out with a per-model timeout so one slow model (e.g. a big local
  // CPU model) can never block the whole council. allSettled never rejects;
  // timed-out / failed models are simply dropped from the panel.
  type Answer = {
    modelId: string;
    modelName: string;
    content: string;
    latency: number;
    tokensUsed: number;
    cost: number;
    role?: CouncilRole;
  };
  const settled = await Promise.allSettled(
    picked.map(async (p, index): Promise<Answer> => {
      const client = new CodeBuddyClient(p.c.apiKey ?? '', p.c.model, p.c.baseURL);
      const t0 = Date.now();
      const prompt = buildCouncilPrompt(task, conductorPlan, index);
      const resp = await Promise.race([
        client.chat([{ role: 'user', content: prompt }], []),
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
        role: conductorPlan.roles[index],
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

  // Fleet — ALSO consult connected peers (other machines' Code Buddy) over the WS mesh via
  // peer.chat, and fold their answers into the SAME judged set. The judge/consensus/scoreboard
  // are source-agnostic (they score answers, not where answers came from). A slow/absent peer is
  // dropped (allSettled + per-peer timeout), never blocking the council.
  if (opts.fleet) {
    if (fleetPeersForCouncil.length === 0) {
      out("🛰️  Fleet — aucun pair connecté (lance `/fleet listen ws://… --jwt …` d'abord).");
    } else {
      out(`🛰️  Fleet — ${fleetPeersForCouncil.length} machine(s) distante(s) consultée(s)…`);
      const { answers: peerAnswers, errors } = await gatherPeerAnswers(
        task,
        fleetPeersForCouncil,
        opts.peerTimeoutMs ?? COUNCIL_TIMEOUT_MS,
        {
          promptForPeer: (_peer, index) => buildCouncilPrompt(task, conductorPlan, picked.length + index),
          roleForPeer: (_peer, index) => conductorPlan.roles[picked.length + index],
        },
      );
      for (const a of peerAnswers) answers.push(a);
      for (const e of errors) out(`  ⚠️ ${e.id}: ${e.message.slice(0, 120)}`);
    }
  }

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
        learnable: false,
      };

  const sources: ConsensusSource[] = answers.map((a) => ({ peerId: a.modelId, model: a.modelName, text: a.content }));
  const consensus = computeTextConsensus(sources);
  const decisionSignals = computeCouncilDecisionSignals(verdict.scores, verdict.winnerIdx, consensus.score);

  const synthesisCandidates: CouncilSynthesisCandidate[] = answers.map((answer, index) => ({
    modelName: answer.modelName,
    roleLabel: answer.role?.label,
    score: verdict.scores[index] ?? 0,
    winner: index === verdict.winnerIdx,
    content: answer.content,
  }));
  const synthesized =
    opts.synthesis !== false && conductorPlan.mode === 'collective' && answers.length > 1 && judgeClient
      ? await synthesizeCouncilAnswer(judgeClient, task, synthesisCandidates, consensus.score, decisionSignals)
      : null;

  // Learn only from reliable judge signals. Fallbacks (no judge / non-JSON /
  // timeout) still produce a useful answer, but must not train future routing.
  if (shouldRecordCouncilLearning(verdict.learnable, decisionSignals.confidence)) {
    const at = new Date().toISOString();
    for (let i = 0; i < answers.length; i++) {
      const provider = picked.find((p) => p.c.model === answers[i]!.modelName)?.c.provider ?? answers[i]!.modelId;
      scoreboard.recordOutcome({
        at,
        taskType,
        model: answers[i]!.modelName,
        provider,
        role: answers[i]!.role?.id,
        won: i === verdict.winnerIdx,
        quality: verdict.scores[i] ?? 0,
        latencyMs: answers[i]!.latency,
        costUsd: answers[i]!.cost ?? 0,
      });
    }
  } else {
    const reason = verdict.learnable ? 'confiance basse' : 'juge indisponible ou fallback';
    out(`\n📊 Apprentissage council ignoré (${reason}).`);
  }

  const winner = answers[verdict.winnerIdx]!;
  if (synthesized) {
    out(`\n🧬 Synthèse collective — ${answers.length} réponses spécialisées\n`);
    out(synthesized.trim());
    out(`\n🏆 Référence du juge — ${winner.modelName}${verdict.rationale ? ` : ${verdict.rationale}` : ''}`);
  } else {
    out(`\n🏆 Meilleure réponse — ${winner.modelName}${verdict.rationale ? ` : ${verdict.rationale}` : ''}\n`);
    out(winner.content.trim());
  }

  if (opts.consensus !== false && answers.length > 1) {
    const pct = Math.round(consensus.score * 100);
    // Jaccard word-overlap on free-form prose is informational, NOT a verdict:
    // two good answers phrased differently legitimately score low. The judge
    // above is the real quality evaluator; this just flags how lexically close
    // the wordings were (high overlap ⇒ the models genuinely converged).
    out(`\n🤝 Accord lexical inter-IA : ${pct}% (recouvrement de mots — le juge ci-dessus évalue le fond).`);
  }
  out(
    `\n🧭 Confiance council : ${decisionSignals.confidence} ` +
      `(marge juge ${decisionSignals.margin.toFixed(2)}, accord ${Math.round(decisionSignals.consensusScore * 100)}% — ` +
      `${decisionSignals.reasons.join('; ')})`,
  );
  const verificationHint = buildCouncilVerificationHint(decisionSignals, taskType);
  if (verificationHint) {
    out(`🔎 ${verificationHint}`);
  }

  out('\n📊 Détail par IA :');
  for (let i = 0; i < answers.length; i++) {
    const mark = i === verdict.winnerIdx ? '🏆' : '  ';
    const role = answers[i]!.role?.label ? ` [${answers[i]!.role!.label}]` : '';
    out(
      `${mark} ${(answers[i]!.modelName + role).padEnd(22)} score ${(verdict.scores[i] ?? 0).toFixed(2)}  ` +
        `${answers[i]!.latency}ms  ${answers[i]!.tokensUsed} tok`,
    );
  }

  out(`\n${scoreboard.print(taskType)}`);
}
