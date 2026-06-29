/**
 * Speech-engine configuration resolvers — the single source of truth for the
 * `CODEBUDDY_SPEECH_*` environment knobs.
 *
 * Both the STT hot path (`speech-reaction.ts`) and the companion control plane
 * (`companion-mode.ts`'s `buddy companion live` preflight) need to know which STT
 * engine is configured and where the Parakeet/sherpa-onnx model lives. They used
 * to keep separate copies, which drifted: companion-mode's copy never learned the
 * in-process `sherpa-rs` engine and silently reported it as `faster-whisper`.
 * Keeping the resolution here means the two can no longer disagree.
 *
 * @module sensory/speech-engine-config
 */

import { homedir } from 'os';
import { join } from 'path';

export type SpeechRecognitionEngine = 'faster-whisper' | 'parakeet' | 'sherpa-rs' | 'auto';

/** Expand a leading `~` / `~/` to the home directory (leaves other paths as-is). */
export function expandSpeechPath(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

/**
 * Resolve the configured STT engine from `CODEBUDDY_SPEECH_ENGINE`. Aliases:
 * `sherpa-rust`/`rust` → `sherpa-rs`; `sherpa-onnx` → `parakeet`; `whisper` →
 * `faster-whisper`. Anything unset/unknown defaults to `faster-whisper`.
 */
export function resolveSpeechRecognitionEngine(): SpeechRecognitionEngine {
  const configured = process.env.CODEBUDDY_SPEECH_ENGINE?.trim().toLowerCase();
  if (configured === 'sherpa-rs' || configured === 'sherpa-rust' || configured === 'rust') return 'sherpa-rs';
  if (configured === 'parakeet' || configured === 'sherpa-onnx') return 'parakeet';
  if (configured === 'faster-whisper' || configured === 'whisper') return 'faster-whisper';
  if (configured === 'auto') return 'auto';
  return 'faster-whisper';
}

/**
 * Location of the NeMo Parakeet / sherpa-onnx model directory (shared by the
 * `parakeet` and `sherpa-rs` engines). Override via `CODEBUDDY_PARAKEET_MODEL_DIR`
 * or `CODEBUDDY_SHERPA_ONNX_MODEL_DIR`.
 */
export function resolveParakeetModelDir(): string {
  return expandSpeechPath(
    process.env.CODEBUDDY_PARAKEET_MODEL_DIR?.trim()
      || process.env.CODEBUDDY_SHERPA_ONNX_MODEL_DIR?.trim()
      || '~/.codebuddy/asr/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
  );
}

/** True when the configured/resolved engine decodes with the Parakeet model. */
export function engineUsesParakeetModel(engine: SpeechRecognitionEngine): boolean {
  return engine === 'parakeet' || engine === 'sherpa-rs' || engine === 'auto';
}
