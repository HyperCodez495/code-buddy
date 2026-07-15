/** Cheap, deterministic and raw-free acoustic scene interpretation. */

import type { VoiceSceneClass } from './voice-turn-coordinator.js';

export interface AudioSceneInput {
  /** Used transiently for metrics only; never returned or persisted. */
  transcript?: string;
  decisionReason?: string;
  playbackCaptureKind?: 'during_playback' | 'echo_tail';
  echoClassification?: 'echo' | 'distinct' | 'unknown';
  rms?: number;
  rmsOn?: number;
  audioMs?: number;
  turnDetector?: string;
  speakerCount?: number;
  aecActive?: boolean;
}

export interface AudioSceneAssessment {
  scene: VoiceSceneClass;
  confidence: number;
  evidence: string[];
  wordCount: number;
  speechMs?: number;
  aecActive: boolean;
}

const DIRECT_REASONS = new Set([
  'addressed',
  'engaged',
  'greeting',
  'directed-request',
  'conversation-close',
]);
const BROADCAST_REASONS = new Set([
  'ambient',
  'ambient-long',
  'ambient-burst',
  'ambient-in-window',
  'no-cue',
  'not-warranted',
]);

function words(text: string | undefined): number {
  return text?.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

function confidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

export function assessAudioScene(input: AudioSceneInput): AudioSceneAssessment {
  const wordCount = words(input.transcript);
  const evidence: string[] = [];
  const base = {
    wordCount,
    ...(Number.isFinite(input.audioMs) && (input.audioMs ?? 0) >= 0
      ? { speechMs: Math.round(input.audioMs!) }
      : {}),
    aecActive: input.aecActive === true,
  };

  if (input.playbackCaptureKind) {
    evidence.push(input.playbackCaptureKind);
    if (input.echoClassification) evidence.push(`echo_${input.echoClassification}`);
    return {
      scene: 'assistant_playback',
      confidence: confidence(input.echoClassification === 'echo' ? 0.99 : 0.82),
      evidence,
      ...base,
    };
  }

  if (input.decisionReason && DIRECT_REASONS.has(input.decisionReason)) {
    evidence.push(`decision_${input.decisionReason}`);
    if (input.turnDetector) evidence.push('semantic_turn_detector');
    return { scene: 'near_speech', confidence: confidence(0.9), evidence, ...base };
  }

  if ((input.speakerCount ?? 0) > 1) {
    evidence.push('multiple_speakers');
    return { scene: 'broadcast', confidence: confidence(0.84), evidence, ...base };
  }

  if (input.decisionReason && BROADCAST_REASONS.has(input.decisionReason)) {
    evidence.push(`decision_${input.decisionReason}`);
    if (wordCount > 16) evidence.push('long_utterance');
    return {
      scene: 'broadcast',
      confidence: confidence(wordCount > 16 ? 0.88 : 0.72),
      evidence,
      ...base,
    };
  }

  const belowGate = Number.isFinite(input.rms)
    && Number.isFinite(input.rmsOn)
    && input.rms! < input.rmsOn!;
  if (wordCount <= 1 && belowGate) {
    evidence.push('below_adaptive_gate');
    return { scene: 'noise', confidence: confidence(0.8), evidence, ...base };
  }

  return { scene: 'unknown', confidence: confidence(0.35), evidence, ...base };
}
