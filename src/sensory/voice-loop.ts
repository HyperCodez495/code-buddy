/**
 * Voice loop — closes the perception→cognition→action loop into speech. Given a
 * transcript of what the robot HEARD (the `onHeard` hook of `speech-reaction.ts`),
 * THINK a short reply with a LOCAL LLM ($0, Ollama) and SPEAK it with a real neural
 * voice (Piper). The result is a thing you can talk to: hear → think → speak.
 *
 * Everything is INJECTABLE (reply / synth / play) so the loop is deterministically
 * testable with no model, no audio device. Opt-in (`CODEBUDDY_SENSORY_SPEAK=true`,
 * gated by the caller), $0, loopback, NEVER-THROWS (a failure is silence, not a crash).
 *
 * The default `replyFn` is a lightweight companion reply. To make the robot *act* on
 * spoken commands (run tools, code), inject a `replyFn` that drives a full agent turn —
 * the loop itself is unchanged.
 *
 * @module sensory/voice-loop
 */

import { spawn } from 'child_process';
import { logger } from '../utils/logger.js';
import { commandExists } from '../utils/command-exists.js';

/** Think: turn what was heard into a short spoken reply ('' → stay silent). */
export type ReplyFn = (heard: string) => Promise<string>;
/** Synthesize: turn reply text into a playable WAV file, return its path. */
export type SynthFn = (text: string) => Promise<string>;
/** Speak: play a WAV file to the speakers (blocking until done). */
export type PlayFn = (wav: string) => Promise<void>;

export interface VoiceReplyOptions {
  /** Injectable "think" step. Default: a short companion reply from a local LLM ($0). */
  replyFn?: ReplyFn;
  /** Injectable "synthesize" step. Default: Piper neural TTS. */
  synth?: SynthFn;
  /** Injectable "speak" step. Default: aplay / pw-play / ffplay (blocking). */
  play?: PlayFn;
  /** Piper voice model (.onnx). Default: CODEBUDDY_TTS_VOICE / _PIPER_MODEL. */
  voice?: string;
  /** Where synth WAVs are written (cleaned up after playback). Default: cwd. */
  rootDir?: string;
  /** Test hook: called with the reply text right after it is spoken. */
  onSpoke?: (text: string) => void;
}

export interface VoiceReadiness {
  /** Text model the default replyFn will try (must be pulled in Ollama). */
  model: string;
  /** Piper voice model path, if configured. */
  voice?: string;
  /** True when speech-out can work (a voice is configured). */
  speakReady: boolean;
  /** Actionable, loud-by-design warnings naming the env to set. */
  warnings: string[];
}

/** Pure prereq check (testable) — what the default `makeVoiceReply()` needs to actually
 *  SPEAK. The robot still HEARS without these; it just stays silent. Used by the server to
 *  fail LOUD (name the env) instead of being mutely wired. */
export function describeVoiceReadiness(env: NodeJS.ProcessEnv = process.env): VoiceReadiness {
  const model = env.CODEBUDDY_SENSORY_SPEAK_MODEL || 'llama3.2';
  const voice = env.CODEBUDDY_TTS_VOICE || env.CODEBUDDY_TTS_PIPER_MODEL || undefined;
  const warnings: string[] = [];
  if (!voice) {
    warnings.push(
      'CODEBUDDY_SENSORY_SPEAK is on but no Piper voice is set — the robot will HEAR but stay SILENT. ' +
        'Set CODEBUDDY_TTS_VOICE=/path/to/voice.onnx.',
    );
  }
  warnings.push(
    `Voice reply uses local text model '${model}' (override with CODEBUDDY_SENSORY_SPEAK_MODEL) — it must be pulled in Ollama, else replies are empty (silent).`,
  );
  return { model, ...(voice ? { voice } : {}), speakReady: Boolean(voice), warnings };
}

const SPEAK_SYSTEM_PROMPT =
  "Tu es le compagnon robot de Patrice. On te parle à voix haute et tu réponds à voix haute. " +
  "Réponds en français, en UNE à DEUX phrases courtes, naturelles, parlées. " +
  "Pas de markdown, pas de listes, pas de code, pas d'emoji.";

/** Default think: a short companion reply from a LOCAL LLM (Ollama, $0). Mirrors the
 *  local-inference pattern of vision-reaction.ts. Best-effort: any failure → '' (silence). */
async function defaultReply(heard: string): Promise<string> {
  try {
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const model = process.env.CODEBUDDY_SENSORY_SPEAK_MODEL || 'llama3.2';
    const baseURL = process.env.CODEBUDDY_SENSORY_SPEAK_BASE_URL || process.env.CODEBUDDY_VISION_BASE_URL || 'http://127.0.0.1:11434/v1';
    const client = new CodeBuddyClient(process.env.OLLAMA_API_KEY || 'ollama', model, baseURL);
    const resp = await client.chat(
      [
        { role: 'system', content: SPEAK_SYSTEM_PROMPT },
        { role: 'user', content: heard },
      ] as never,
      [],
    );
    return (resp?.choices?.[0]?.message?.content ?? '').trim();
  } catch (err) {
    logger.warn(`[voice] local reply failed: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

/** Default synth: Piper neural TTS via the shared text_to_speech synthesizer. */
function makeDefaultSynth(voice?: string, rootDir?: string): SynthFn {
  return async (text: string) => {
    const { synthesizeTextToSpeech } = await import('../tools/text-to-speech-tool.js');
    const res = await synthesizeTextToSpeech(
      { text, provider: 'piper', format: 'wav', ...(voice ? { voice } : {}) },
      rootDir ? { rootDir } : {},
    );
    return res.outputPath;
  };
}

/** Default speak: play a WAV with the first available local player, blocking until done. */
async function defaultPlay(wav: string): Promise<void> {
  const candidates: Array<{ cmd: string; args: (f: string) => string[] }> = [
    { cmd: 'aplay', args: (f) => ['-q', f] },
    { cmd: 'pw-play', args: (f) => [f] },
    { cmd: 'ffplay', args: (f) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', f] },
  ];
  for (const c of candidates) {
    if (!(await commandExists(c.cmd))) continue;
    await new Promise<void>((resolve) => {
      const child = spawn(c.cmd, c.args(wav), { stdio: 'ignore' });
      child.on('error', () => resolve());
      child.on('close', () => resolve());
    });
    return;
  }
  logger.warn('[voice] no audio player available (aplay/pw-play/ffplay) — staying silent');
}

/**
 * Build an `onHeard` handler that thinks then speaks. Never-throws.
 * Wire it into `wireSpeechReaction({ onHeard: makeVoiceReply() })`.
 */
export function makeVoiceReply(options: VoiceReplyOptions = {}): (heard: string) => Promise<void> {
  const replyFn = options.replyFn ?? defaultReply;
  const synth = options.synth ?? makeDefaultSynth(options.voice, options.rootDir);
  const play = options.play ?? defaultPlay;

  return async (heard: string): Promise<void> => {
    try {
      const reply = (await replyFn(heard)).trim();
      if (!reply) return; // nothing to say → silence (never an error)
      const wav = await synth(reply);
      if (!wav) return;
      await play(wav);
      logger.info(`[voice] spoke → ${reply}`);
      options.onSpoke?.(reply);
      // Best-effort cleanup of the synthesized WAV.
      try {
        const { unlink } = await import('fs/promises');
        await unlink(wav);
      } catch {
        /* leave the file if cleanup fails — not worth surfacing */
      }
    } catch (err) {
      logger.warn(`[voice] reply→speak failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
