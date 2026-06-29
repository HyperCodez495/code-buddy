/**
 * Semantic vision reaction — turns the HIGH-LEVEL vision events from the Python
 * vision sidecar (`person_entered` / `person_left` / `drowsy`) into a remote
 * alert. These are state-machine TRANSITIONS (already deduped at the detector,
 * one per transition), so each is meaningful → always alert, no extra throttling.
 * Opt-in via the same camera gate as the motion reaction. Best-effort, never-throws.
 *
 * @module sensory/semantic-vision-reaction
 */
import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';
import type { BaseEvent } from '../events/types.js';
import { perceptionOf } from './reactions.js';
import { sendTelegramAlert } from './alert.js';

/** Human-readable alert per semantic event kind (extend as detectors are added). */
const MESSAGES: Record<string, string> = {
  person_entered: "👤 Quelqu'un est entré dans le champ",
  person_left: '🚪 Plus personne dans le champ',
  drowsy: '😴 Somnolence détectée (yeux fermés)',
};

export interface SemanticVisionOptions {
  cwd?: string;
  /** Speak the arrival greeting. Default: sayNow (Piper, active persona's voice). Injectable for tests. */
  greet?: (text: string) => Promise<void>;
  /** Called right after a greeting so the conversation window opens (server wires decider.markEngaged). */
  onEngage?: () => void;
  now?: () => number;
}

export function wireSemanticVisionReaction(options: SemanticVisionOptions = {}): () => void {
  const bus = getGlobalEventBus();
  // Greet an arriving person aloud (opt-in) — the robot stops being a tool that waits and becomes a
  // presence that notices you. Cooldown'd so a person flickering in/out doesn't re-greet.
  const greetEnabled = process.env.CODEBUDDY_SENSORY_GREET === 'true';
  const greetCooldownMs = Number(process.env.CODEBUDDY_SENSORY_GREET_COOLDOWN_MS) || 60_000;
  const now = options.now ?? (() => Date.now());
  let lastGreetAt = Number.NEGATIVE_INFINITY;

  const id = bus.on('sensory:perception', (evt: BaseEvent) => {
    const p = perceptionOf(evt);
    if (p.modality !== 'vision' || !p.kind || !(p.kind in MESSAGES)) return;
    const kind = p.kind;
    const payload = (p.payload ?? {}) as { imagePath?: string; camera?: string };

    void (async () => {
      try {
        const label = MESSAGES[kind] ?? kind;
        const { recordCompanionPercept } = await import('../companion/percepts.js');
        await recordCompanionPercept(
          {
            modality: 'vision',
            source: 'semantic_vision_reaction',
            summary: `${kind} → ${label}`,
            confidence: 0.95,
            payload: { event: kind, imagePath: payload.imagePath, camera: payload.camera },
            tags: ['vision', 'event', kind],
          },
          options.cwd ? { cwd: options.cwd } : {},
        );
        logger.info(`[vision] semantic event → ${kind}`);
        await sendTelegramAlert(`${label}${payload.camera ? ` (${payload.camera})` : ''}`, payload.imagePath);
      } catch (err) {
        logger.warn(`[vision] semantic reaction failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Spoken greeting on arrival (separate guard so a Telegram/percept hiccup never mutes it).
      if (kind === 'person_entered' && greetEnabled) {
        const t = now();
        if (t - lastGreetAt < greetCooldownMs) return;
        lastGreetAt = t;
        try {
          const { getActivePersonaVoiceAsync } = await import('../personas/persona-manager.js');
          const greeting = (await getActivePersonaVoiceAsync()).greeting || 'Bonjour ! Je suis là si tu as besoin.';
          const greet =
            options.greet ??
            (async (text: string) => {
              const { sayNow } = await import('./voice-loop.js');
              await sayNow(text);
            });
          await greet(greeting);
          options.onEngage?.(); // open the conversation window — follow-ups are now treated as addressed
          logger.info(`[vision] greeted arrival → ${greeting}`);
        } catch (err) {
          logger.warn(`[vision] arrival greeting failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    })();
  });
  return () => bus.off(id);
}
