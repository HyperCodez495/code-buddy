/**
 * Council triage — a cheap single-LLM gate in FRONT of the expensive
 * multi-model fan-out (OpenHuman-inspired drop/ack/react/escalate: only
 * "escalate" convenes the full council).
 *
 * The Code Buddy Council fans a task out to N models + a judge + a synthesis
 * pass — real money and latency. A trivial, factual, unambiguous question
 * does not deserve that. When `CODEBUDDY_COUNCIL_TRIAGE` is on, one cheap
 * (latency-routed, local/free-preferable) model classifies the request:
 *
 *   - SINGLE  → the same cheap model answers, and we return early with a
 *               well-formed `CouncilRunResult` marked `triaged: true`. The
 *               fan-out is NEVER launched.
 *   - COUNCIL → we return null and the engine runs the full deliberation.
 *
 * FAIL-SAFE TOWARD QUALITY: any error, timeout, empty answer, or non-parsable
 * verdict returns null ⇒ the full council runs. Triage can only ever SAVE
 * money, never silently downgrade a hard question to one model. The parser
 * accepts SINGLE only on an explicit, well-formed verdict; everything else
 * (including the classifier's "when in doubt") resolves to COUNCIL.
 *
 * Opt-in, default OFF ⇒ this module is never even entered and the council
 * behaves exactly as before.
 *
 * @module council/triage
 */

import { withTimeout } from './with-timeout.js';
import { sanitizeModelOutput } from '../utils/output-sanitizer.js';
import { inferTaskType } from '../fleet/model-capability-heuristics.js';
import { computeTextConsensus } from '../fleet/result-aggregator.js';
import { computeCouncilDecisionSignals } from './signals.js';
import { computeDeliberationHealth } from './deliberation-health.js';
import type {
  CouncilAnswer,
  CouncilCandidate,
  CouncilChatClient,
  CouncilConductorPlan,
  CouncilEngineDeps,
  CouncilOptions,
  CouncilProgressEvent,
  CouncilRunResult,
  JudgeVerdict,
  TriageModelSelection,
} from './types.js';

/** Only an explicit, opt-in truthy value enables triage. */
export function isCouncilTriageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.CODEBUDDY_COUNCIL_TRIAGE ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function isTriageLocalOnly(env: NodeJS.ProcessEnv): boolean {
  const v = (env.CODEBUDDY_COUNCIL_TRIAGE_LOCAL_ONLY ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function triageTimeoutMs(deps: CouncilEngineDeps, env: NodeJS.ProcessEnv): number {
  if (typeof deps.timeoutMs === 'number' && deps.timeoutMs > 0) return deps.timeoutMs;
  const raw = Number(env.CODEBUDDY_COUNCIL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 45000;
}

const TRIAGE_SYSTEM =
  'You are the fast triage stage of Code Buddy Council. Decide whether a request needs the ' +
  'full multi-model council (several LLMs + a judge — expensive) or can be answered just as ' +
  'well by ONE competent model (cheap).\n' +
  'Answer COUNCIL when the request is hard, ambiguous, high-stakes, a design/architecture ' +
  'trade-off, a security or correctness judgement, or genuinely benefits from several ' +
  'independent perspectives.\n' +
  'Answer SINGLE only when the request is factual, trivial, unambiguous, and a single good ' +
  'model would answer it as well as many would.\n' +
  'When in doubt, answer COUNCIL.\n' +
  'Reply in EXACTLY this format and nothing else:\n' +
  'DECISION: SINGLE or COUNCIL\n' +
  'REASON: <one short sentence>';

export interface TriageDecision {
  decision: 'single' | 'council';
  reason?: string;
}

/**
 * Parse the falsifiable triage contract. SINGLE is accepted ONLY on an
 * explicit, well-formed verdict (`DECISION: SINGLE`, or a bare `SINGLE`);
 * any noise, ambiguity, or a COUNCIL verdict resolves to COUNCIL. This is the
 * quality fail-safe at the parsing layer: a garbled reply can never downgrade
 * the run to one model.
 */
export function parseTriageDecision(text: string): TriageDecision {
  const clean = (text ?? '').trim();
  const reason = clean.match(/reason\s*:\s*(.+)/i)?.[1]?.trim().slice(0, 200);
  const withReason = (decision: 'single' | 'council'): TriageDecision =>
    reason ? { decision, reason } : { decision };

  const decisionLine = clean.match(/decision\s*:\s*(single|council)/i);
  if (decisionLine) {
    return withReason(decisionLine[1]!.toLowerCase() === 'single' ? 'single' : 'council');
  }
  // No DECISION line — accept SINGLE only when the whole reply is exactly that.
  if (/^single\.?$/i.test(clean)) return withReason('single');
  // Unparsable / ambiguous ⇒ COUNCIL (fail-safe toward quality).
  return withReason('council');
}

async function defaultSelectTriageModel(
  task: string,
  opts: { localOnly?: boolean; preferModel?: string; env?: NodeJS.ProcessEnv },
): Promise<TriageModelSelection | null> {
  const { selectFastestModel } = await import('../fleet/model-selector.js');
  const sel = await selectFastestModel(task, {
    ...(opts.localOnly ? { localOnly: true } : {}),
    ...(opts.preferModel ? { preferModel: opts.preferModel } : {}),
    ...(opts.env ? { env: opts.env } : {}),
  });
  if (!sel) return null;
  return {
    provider: sel.provider,
    model: sel.model,
    ...(sel.apiKey ? { apiKey: sel.apiKey } : {}),
    ...(sel.baseURL ? { baseURL: sel.baseURL } : {}),
    isLocal: sel.isLocal,
    reason: sel.reason,
  };
}

/**
 * Run the triage stage. Returns a triaged `CouncilRunResult` when the request
 * is classified SINGLE (fan-out skipped), or `null` in every other case
 * (COUNCIL verdict, explicit multi-model intent, or ANY failure) so the engine
 * proceeds to the full deliberation. Never throws.
 */
export async function runCouncilTriage(
  task: string,
  opts: CouncilOptions,
  deps: CouncilEngineDeps,
  onProgress: (e: CouncilProgressEvent) => void = () => {},
): Promise<CouncilRunResult | null> {
  const env = deps.env ?? process.env;

  // Honour explicit deliberation intent: a pinned model set or a fleet run
  // means the user WANTS the full council — never triage it away.
  if (opts.models || opts.fleet) return null;

  try {
    const select = deps.selectTriageModel ?? defaultSelectTriageModel;
    const preferModel = (env.CODEBUDDY_COUNCIL_TRIAGE_MODEL ?? '').trim();
    const selection = await select(task, {
      ...(isTriageLocalOnly(env) ? { localOnly: true } : {}),
      ...(preferModel ? { preferModel } : {}),
      env,
    });
    if (!selection) return null; // no cheap model available → full council

    const candidate: CouncilCandidate = {
      provider: selection.provider,
      model: selection.model,
      ...(selection.apiKey ? { apiKey: selection.apiKey } : {}),
      ...(selection.baseURL ? { baseURL: selection.baseURL } : {}),
      costInputUsdPerMtok: 0,
    };

    let client: CouncilChatClient;
    try {
      client = deps.clientFactory(candidate);
    } catch {
      return null; // cannot build the triage client → full council
    }

    const timeoutMs = triageTimeoutMs(deps, env);

    // 1. classify (one cheap call).
    const classifyResp = await withTimeout(
      client.chat([
        { role: 'system', content: TRIAGE_SYSTEM },
        { role: 'user', content: task },
      ]),
      timeoutMs,
      'triage',
    );
    const decision = parseTriageDecision(sanitizeModelOutput(classifyResp.content));
    if (decision.decision !== 'single') {
      onProgress({ type: 'triage', decision: 'council', ...(decision.reason ? { reason: decision.reason } : {}) });
      return null; // COUNCIL / unparsable → full council
    }

    // 2. answer with the single model.
    const t0 = Date.now();
    const answerResp = await withTimeout(
      client.chat([{ role: 'user', content: task }]),
      timeoutMs,
      selection.model,
    );
    const content = sanitizeModelOutput(answerResp.content).trim();
    if (!content) return null; // empty single answer → full council (fail-safe)

    onProgress({
      type: 'triage',
      decision: 'single',
      model: selection.model,
      ...(decision.reason ? { reason: decision.reason } : {}),
    });

    const taskType = (opts.taskType || inferTaskType(task)).toLowerCase();
    const answer: CouncilAnswer = {
      source: { kind: 'local', provider: selection.provider, model: selection.model },
      displayName: selection.model,
      content,
      latencyMs: Date.now() - t0,
      tokensUsed: answerResp.totalTokens,
      // The triage model is the cheapest available; treat its marginal cost as
      // ~0 for the ledger (a precise $/Mtok is not carried by the selector).
      costUsd: 0,
    };
    const plan: CouncilConductorPlan = {
      mode: 'direct',
      reason: 'triage: question jugée simple — réponse mono-modèle (fan-out évité)',
      roles: [],
    };
    const consensus = computeTextConsensus([
      { peerId: selection.provider, model: selection.model, text: content },
    ]);
    const verdict: JudgeVerdict = {
      kind: 'judged',
      winnerIdx: 0,
      scores: [1],
      roleScores: [1],
      rationale: decision.reason
        ? `triage mono-modèle : ${decision.reason}`
        : 'triage mono-modèle (question jugée simple)',
      verified: '',
      judgeModel: null,
      neutral: false,
    };
    const signals = computeCouncilDecisionSignals([1], 0, consensus.score, { collective: false });
    // DHI is honest about there being NO deliberation (no judge) — but a
    // triaged run is not a degraded council, so we do NOT persist it to the
    // health ledger (that would flood it with zeros). The field exists for
    // shape completeness; the host's healthSink is deliberately not called.
    const health = computeDeliberationHealth({
      at: (deps.now?.() ?? new Date()).toISOString(),
      taskType,
      planMode: 'direct',
      seats: 1,
      answers: [{ content, winner: true }],
      judgeAlive: false,
      scores: [1],
      consensusScore: consensus.score,
      synthesis: null,
    });

    return {
      taskType,
      plan,
      answers: [answer],
      failures: [],
      verdict,
      consensus,
      signals,
      synthesis: null,
      finalText: content,
      learned: false,
      learnSkipReason: 'triage mono-modèle (pas de délibération)',
      health,
      triaged: true,
      singleModel: selection.model,
      ...(decision.reason ? { triageReason: decision.reason } : {}),
    };
  } catch {
    // FAIL-SAFE: any error → full council. Never let triage break a run.
    return null;
  }
}
