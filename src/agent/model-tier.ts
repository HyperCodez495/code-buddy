/**
 * Autonomous model tiering — a free-first escalation ladder.
 *
 * For Code Buddy to run *continuously* (always-on, like a smart speaker) without
 * burning paid tokens, routine work runs on the **fastest local** model, climbs
 * to a **more powerful model on the network** (a Tailscale peer's Ollama — still
 * $0) when a task needs more, and only falls back to a **paid cloud** model as a
 * last resort.
 *
 *   tier 0  local      — fastest local model (this box's GPU), basic tasks
 *   tier 1  network    — bigger model on a Tailscale peer (e.g. a 2×3090 host), free
 *   tier 2  escalated  — paid cloud model, last resort
 *
 * Pure decision core: given the configured tiers and an escalation signal, it
 * returns which model to use and why. It performs no inference/routing itself.
 */

export type ModelTier = 'local' | 'network' | 'escalated';

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export interface NetworkModel {
  model: string;
  /** A Tailscale peer's OpenAI-compatible (Ollama) endpoint, e.g. http://darkstar:11434/v1 */
  baseUrl: string;
  label?: string;
}

export interface ModelTierConfig {
  /** Fastest local, $0 model for basic continuous work (an Ollama model). */
  localModel: string;
  /** Base URL of the local OpenAI-compatible endpoint (Ollama). */
  localBaseUrl: string;
  /** More-powerful but still free models reachable over the network (Tailscale peers). */
  networkModels?: NetworkModel[];
  /** Paid cloud model, last resort (undefined = never escalate to paid). */
  escalationModel?: string;
}

export interface EscalationSignal {
  /** Caller explicitly wants the strongest available model for this turn. */
  escalate?: boolean;
  /** Task priority — may climb the ladder if the policy opts in. */
  priority?: TaskPriority;
  /** Consecutive failures on this task — each threshold climbs one rung. */
  failures?: number;
}

export interface ModelTierPolicy {
  /** Climb the ladder when priority is at least this. Unset = never on priority alone. */
  escalateAtPriority?: 'critical' | 'high';
  /** Failures before climbing one rung (default 2). Set 0 to disable. */
  escalateAfterFailures?: number;
}

export interface AutonomousModelChoice {
  model: string;
  /** Present for local/network tiers so callers can point the agent at the endpoint. */
  baseUrl?: string;
  tier: ModelTier;
  /** True only when the paid cloud model was chosen. */
  paid: boolean;
  reason: string;
}

const DEFAULT_LOCAL_MODEL = 'llama3.2';
const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434/v1';
const DEFAULT_ESCALATE_AFTER_FAILURES = 2;

/**
 * Resolve the ladder from the environment.
 *
 * - local model:    `CODEBUDDY_LOCAL_MODEL`
 * - local base URL: `OLLAMA_BASE_URL` → `OLLAMA_HOST` (+ `/v1`) → default
 * - network models: `CODEBUDDY_NETWORK_MODELS` — csv of `model@baseUrl` entries
 *   (e.g. `qwen3.6:27b@http://darkstar:11434/v1,...`)
 * - escalation:     `CODEBUDDY_ESCALATION_MODEL` → `GROK_MODEL` → none.
 */
export function resolveModelTierConfig(env: NodeJS.ProcessEnv = process.env): ModelTierConfig {
  const localModel = env['CODEBUDDY_LOCAL_MODEL']?.trim() || DEFAULT_LOCAL_MODEL;
  const localBaseUrl = normalizeBaseUrl(
    env['OLLAMA_BASE_URL']?.trim()
    || (env['OLLAMA_HOST']?.trim() ? `${env['OLLAMA_HOST']!.trim().replace(/\/+$/, '')}/v1` : '')
    || DEFAULT_LOCAL_BASE_URL,
  );
  const networkModels = parseNetworkModels(env['CODEBUDDY_NETWORK_MODELS']);
  const escalationModel = env['CODEBUDDY_ESCALATION_MODEL']?.trim() || env['GROK_MODEL']?.trim();
  return {
    localModel,
    localBaseUrl,
    ...(networkModels.length ? { networkModels } : {}),
    ...(escalationModel ? { escalationModel } : {}),
  };
}

export function parseNetworkModels(raw: string | undefined): NetworkModel[] {
  if (!raw?.trim()) return [];
  return raw.split(',').map((part) => part.trim()).filter(Boolean).flatMap((entry) => {
    const at = entry.lastIndexOf('@');
    if (at <= 0) return [];
    const model = entry.slice(0, at).trim();
    const baseUrl = normalizeBaseUrl(entry.slice(at + 1).trim());
    return model && baseUrl ? [{ model, baseUrl }] : [];
  });
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Escalation rung 0 (local) / 1 (network) / 2 (paid) implied by the signal. */
function escalationLevel(signal: EscalationSignal, policy: ModelTierPolicy): 0 | 1 | 2 {
  let level = 0;
  if (signal.escalate) level = 2;

  const after = policy.escalateAfterFailures ?? DEFAULT_ESCALATE_AFTER_FAILURES;
  const failures = signal.failures ?? 0;
  if (after > 0) {
    if (failures >= after * 2) level = Math.max(level, 2);
    else if (failures >= after) level = Math.max(level, 1);
  }

  if (policy.escalateAtPriority && signal.priority
    && PRIORITY_RANK[signal.priority] >= PRIORITY_RANK[policy.escalateAtPriority]) {
    level = Math.max(level, signal.priority === 'critical' ? 2 : 1);
  }
  return Math.min(level, 2) as 0 | 1 | 2;
}

/**
 * Choose the model for an autonomous turn. Free-first: local by default, the
 * network (free) tier when more power is needed, paid only as a last resort —
 * and it degrades down the ladder when a higher tier isn't configured, so the
 * loop always keeps running (preferring free).
 */
export function chooseAutonomousModel(
  config: ModelTierConfig,
  signal: EscalationSignal = {},
  policy: ModelTierPolicy = {},
): AutonomousModelChoice {
  const level = escalationLevel(signal, policy);
  const why = describeLevel(level, signal, policy);

  // Preference order per rung — always able to fall back to free tiers.
  const order: ModelTier[] = level >= 2
    ? ['escalated', 'network', 'local']
    : level === 1
      ? ['network', 'local']
      : ['local'];

  for (const tier of order) {
    if (tier === 'local') {
      return localChoice(config, why);
    }
    if (tier === 'network' && config.networkModels && config.networkModels.length > 0) {
      const net = config.networkModels[0]!;
      return {
        model: net.model,
        baseUrl: net.baseUrl,
        tier: 'network',
        paid: false,
        reason: `${why} → network model ${net.label ?? net.model} (free, ${net.baseUrl})`,
      };
    }
    if (tier === 'escalated' && config.escalationModel) {
      return {
        model: config.escalationModel,
        tier: 'escalated',
        paid: true,
        reason: `${why} → escalated to paid ${config.escalationModel}`,
      };
    }
  }
  return localChoice(config, `${why} (no higher tier configured — staying local/free)`);
}

function localChoice(config: ModelTierConfig, why: string): AutonomousModelChoice {
  return {
    model: config.localModel,
    baseUrl: config.localBaseUrl,
    tier: 'local',
    paid: false,
    reason: why,
  };
}

function describeLevel(level: 0 | 1 | 2, signal: EscalationSignal, policy: ModelTierPolicy): string {
  if (level === 0) return 'basic task on the fastest local ($0) model';
  const bits: string[] = [];
  if (signal.escalate) bits.push('explicit escalation');
  if ((signal.failures ?? 0) > 0) bits.push(`${signal.failures} failures`);
  if (policy.escalateAtPriority && signal.priority) bits.push(`priority ${signal.priority}`);
  return `needs more power (${bits.join('; ') || 'policy'})`;
}
