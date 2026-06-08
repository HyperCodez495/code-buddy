/**
 * Autonomous model tiering — local-first, escalate-on-demand.
 *
 * For Code Buddy to run *continuously* (always-on, like a smart speaker) without
 * burning paid API tokens, the routine/idle/heartbeat loop must default to a
 * LOCAL, zero-marginal-cost model (Ollama on the box's GPU) and only escalate to
 * a strong, likely-paid model when a task genuinely needs it.
 *
 * This module is the pure decision core: given the configured tiers and an
 * escalation signal, it returns which model to use and why. It does not perform
 * inference or routing itself — callers (HeartbeatEngine, the autonomous fleet
 * loop) feed its choice into the agent.
 */

export type ModelTier = 'local' | 'escalated';

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export interface ModelTierConfig {
  /** Local, $0 model for continuous work (e.g. an Ollama model). */
  localModel: string;
  /** Base URL of the local OpenAI-compatible endpoint (Ollama). */
  localBaseUrl: string;
  /** Strong, likely-paid model to escalate to (undefined = no escalation available). */
  escalationModel?: string;
}

export interface EscalationSignal {
  /** Caller explicitly wants the strong model for this turn. */
  escalate?: boolean;
  /** Task priority — may trigger escalation if the policy opts in. */
  priority?: TaskPriority;
  /** Consecutive local-tier failures on this task (escalate after enough). */
  failures?: number;
}

export interface ModelTierPolicy {
  /** Auto-escalate when priority is at least this. Unset = never escalate on priority alone. */
  escalateAtPriority?: 'critical' | 'high';
  /** Escalate after this many local failures (default 2). Set 0 to disable. */
  escalateAfterFailures?: number;
}

export interface AutonomousModelChoice {
  model: string;
  /** Present for the local tier so callers can point the agent at Ollama. */
  baseUrl?: string;
  tier: ModelTier;
  /** True only when the escalated (paid) model was chosen. */
  paid: boolean;
  reason: string;
}

const DEFAULT_LOCAL_MODEL = 'llama3.2';
const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434/v1';
const DEFAULT_ESCALATE_AFTER_FAILURES = 2;

/**
 * Resolve the local/escalation tiers from the environment.
 *
 * - local model:   `CODEBUDDY_LOCAL_MODEL`
 * - local base URL: `OLLAMA_BASE_URL` → `OLLAMA_HOST` (+ `/v1`) → default
 * - escalation:    `CODEBUDDY_ESCALATION_MODEL` → `GROK_MODEL` (the configured
 *   paid default) → none.
 */
export function resolveModelTierConfig(env: NodeJS.ProcessEnv = process.env): ModelTierConfig {
  const localModel = env['CODEBUDDY_LOCAL_MODEL']?.trim() || DEFAULT_LOCAL_MODEL;
  const localBaseUrl = normalizeBaseUrl(
    env['OLLAMA_BASE_URL']?.trim()
    || (env['OLLAMA_HOST']?.trim() ? `${env['OLLAMA_HOST']!.trim().replace(/\/+$/, '')}/v1` : '')
    || DEFAULT_LOCAL_BASE_URL,
  );
  const escalationModel = env['CODEBUDDY_ESCALATION_MODEL']?.trim() || env['GROK_MODEL']?.trim();
  return {
    localModel,
    localBaseUrl,
    ...(escalationModel ? { escalationModel } : {}),
  };
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Choose the model for an autonomous turn. Local by default; escalate only when
 * the signal warrants it AND an escalation model is configured. When escalation
 * is warranted but unavailable, stays local and says so (so the loop keeps
 * running for free rather than failing).
 */
export function chooseAutonomousModel(
  config: ModelTierConfig,
  signal: EscalationSignal = {},
  policy: ModelTierPolicy = {},
): AutonomousModelChoice {
  const local: AutonomousModelChoice = {
    model: config.localModel,
    baseUrl: config.localBaseUrl,
    tier: 'local',
    paid: false,
    reason: 'routine autonomous work runs on the local ($0) model',
  };

  const escalateAfterFailures = policy.escalateAfterFailures ?? DEFAULT_ESCALATE_AFTER_FAILURES;
  const reasons: string[] = [];
  if (signal.escalate) reasons.push('caller requested escalation');
  if (
    policy.escalateAtPriority
    && signal.priority
    && PRIORITY_RANK[signal.priority] >= PRIORITY_RANK[policy.escalateAtPriority]
  ) {
    reasons.push(`priority '${signal.priority}' ≥ '${policy.escalateAtPriority}'`);
  }
  if (escalateAfterFailures > 0 && (signal.failures ?? 0) >= escalateAfterFailures) {
    reasons.push(`${signal.failures} local failures ≥ ${escalateAfterFailures}`);
  }

  if (reasons.length === 0) {
    return local;
  }
  if (!config.escalationModel) {
    return {
      ...local,
      reason: `escalation warranted (${reasons.join('; ')}) but no escalation model configured — staying local`,
    };
  }
  return {
    model: config.escalationModel,
    tier: 'escalated',
    paid: true,
    reason: `escalated to the strong model: ${reasons.join('; ')}`,
  };
}
