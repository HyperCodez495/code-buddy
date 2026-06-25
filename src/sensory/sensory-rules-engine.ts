/**
 * Sensory rules engine — declarative event→action.
 *
 * Loads `~/.codebuddy/sensory-rules.json`, subscribes to `sensory:perception`,
 * matches each event (kind / payload filters / time-of-day window), respects a
 * per-rule cooldown, and dispatches to the action executor. Every firing is
 * audit-logged to `~/.codebuddy/companion/rule-runs.jsonl`. The security model
 * (injection-safe context, destructive-block) lives in sensory-action-executor.
 *
 * @module sensory/sensory-rules-engine
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import type { BaseEvent } from '../events/types.js';
import { perceptionOf } from './reactions.js';
import { executeSensoryAction, type SensoryAction, type SensoryEventContext } from './sensory-action-executor.js';

export interface SensoryRule {
  id: string;
  name?: string;
  enabled?: boolean;
  match: { modality?: string; kind: string; filters?: Record<string, string>; between?: [string, string] };
  action: SensoryAction;
  cooldownMs?: number;
}

const RULES_PATH = process.env.CODEBUDDY_SENSORY_RULES_FILE || join(homedir(), '.codebuddy', 'sensory-rules.json');
const AUDIT_PATH = join(homedir(), '.codebuddy', 'companion', 'rule-runs.jsonl');

export async function loadSensoryRules(path = RULES_PATH): Promise<SensoryRule[]> {
  try {
    const raw = await readFile(path, 'utf8');
    const data = JSON.parse(raw) as { rules?: SensoryRule[] } | SensoryRule[];
    const rules = Array.isArray(data) ? data : (data.rules ?? []);
    return rules.filter((r) => r && r.match?.kind && r.action?.type);
  } catch {
    return [];
  }
}

/** Is `now` (local HH:MM) within [start,end], wrapping past midnight (e.g. 22:00→06:00)? */
export function withinWindow(now: Date, between?: [string, string]): boolean {
  if (!between) return true;
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const cur = now.getHours() * 60 + now.getMinutes();
  const a = toMin(between[0]);
  const b = toMin(between[1]);
  return a <= b ? cur >= a && cur <= b : cur >= a || cur <= b;
}

export function ruleMatches(
  rule: SensoryRule,
  p: { modality?: string; kind?: string; payload?: unknown },
  now: Date,
): boolean {
  if (rule.enabled === false) return false;
  if (rule.match.modality && rule.match.modality !== p.modality) return false;
  if (rule.match.kind !== p.kind) return false;
  if (!withinWindow(now, rule.match.between)) return false;
  if (rule.match.filters) {
    const payload = (p.payload ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(rule.match.filters)) {
      if (String(payload[k] ?? '') !== String(v)) return false;
    }
  }
  return true;
}

export function wireSensoryRules(options: { rules?: SensoryRule[]; now?: () => number } = {}): () => void {
  const bus = getGlobalEventBus();
  const now = options.now ?? (() => Date.now());
  let rules: SensoryRule[] = options.rules ?? [];
  if (!options.rules) {
    void loadSensoryRules().then((r) => {
      rules = r;
      logger.info(`[rules] loaded ${r.length} sensory rule(s)`);
    });
  }
  const lastFired = new Map<string, number>();

  const id = bus.on('sensory:perception', (evt: BaseEvent) => {
    const p = perceptionOf(evt);
    const t = now();
    for (const rule of rules) {
      if (!ruleMatches(rule, p, new Date(t))) continue;
      const cd = rule.cooldownMs ?? 0;
      if (cd > 0 && t - (lastFired.get(rule.id) ?? Number.NEGATIVE_INFINITY) < cd) continue;
      lastFired.set(rule.id, t);

      const payload = (p.payload ?? {}) as Record<string, unknown>;
      const ctx: SensoryEventContext = {
        modality: p.modality,
        kind: p.kind,
        salience: p.salience,
        camera: typeof payload.camera === 'string' ? payload.camera : undefined,
        description: typeof payload.description === 'string' ? payload.description : undefined,
        imagePath: typeof payload.imagePath === 'string' ? payload.imagePath : undefined,
        payload,
      };

      void (async () => {
        const res = await executeSensoryAction(rule.action, ctx).catch((e) => ({ ok: false, detail: String(e) }));
        logger.info(`[rules] ${rule.id} (${rule.action.type}) → ${res.ok ? 'ok' : 'FAIL'}${res.detail ? `: ${res.detail.slice(0, 80)}` : ''}`);
        try {
          await mkdir(join(homedir(), '.codebuddy', 'companion'), { recursive: true });
          await appendFile(
            AUDIT_PATH,
            JSON.stringify({ ts: t, rule: rule.id, action: rule.action.type, kind: p.kind, ok: res.ok, detail: res.detail }) + '\n',
          );
        } catch {
          /* best-effort audit */
        }
      })();
    }
  });
  return () => bus.off(id);
}

export const __test = { ruleMatches, withinWindow, loadSensoryRules };
