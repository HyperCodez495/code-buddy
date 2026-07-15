import { randomUUID } from 'node:crypto';

import { detectEmotion, type Emotion } from '../companion/reply-augment.js';
import { planConversationResponse } from '../conversation/discourse-planner.js';

export type AvatarAffect =
  | 'neutral'
  | 'attentive'
  | 'warm'
  | 'joyful'
  | 'concerned'
  | 'thoughtful'
  | 'playful'
  | 'confident';

export type AvatarGesture =
  | 'none'
  | 'small_nod'
  | 'head_tilt'
  | 'open_palm'
  | 'soft_shrug'
  | 'thinking_glance';

export type AvatarGaze = 'user' | 'camera' | 'thinking_away';
export type AvatarBackchannel = 'none' | 'attentive_nod' | 'warm_ack' | 'concerned_ack';

export interface AvatarProsodyCue {
  onset: 'gentle' | 'direct' | 'reflective';
  emphasis: 'light' | 'normal' | 'strong';
  breathBeforeMs: number;
  terminalPauseMs: number;
}

export interface AvatarDeliveryInput {
  pace: 'slow' | 'balanced' | 'brisk';
  pauseStyle: 'reflective' | 'natural' | 'light';
  responseShape: 'compact' | 'balanced' | 'expanded';
  confidence: 'low' | 'medium' | 'high';
  targetWpm: number;
}

/** Raw-free acoustic direction consumed by Unreal/MetaHuman. */
export interface AvatarDeliveryCue extends AvatarDeliveryInput {
  /** Suggested body/gesture settling time between spoken sentences. */
  sentencePauseMs: number;
}

export const AVATAR_PROTOCOL_VERSION = 1;
/** Keep one base64 event comfortably below the Gateway backpressure ceiling. */
export const MAX_AVATAR_AUDIO_CHUNK_BYTES = 48 * 1024;

export interface AvatarPerformanceCue {
  affect: AvatarAffect;
  intensity: number;
  gesture: AvatarGesture;
  gaze: AvatarGaze;
  speakingStyle: 'brief' | 'conversational' | 'reflective' | 'deliberative';
  /** Silent acknowledgement shown while cognition prepares the spoken answer. */
  backchannel: AvatarBackchannel;
  /** Additive V1 field. Older renderers safely ignore it. */
  delivery?: AvatarDeliveryCue;
}

interface AvatarEventMetadata {
  version: 1;
  id: string;
  sequence: number;
  timestamp: string;
}

interface AvatarTurnEvent {
  turnId: string;
}

export type AvatarEvent = AvatarEventMetadata &
  (
    | (AvatarTurnEvent & {
        type: 'avatar.turn.started';
        cue: AvatarPerformanceCue;
      })
    | (AvatarTurnEvent & {
        type: 'avatar.speech.prepared';
        text: string;
        cue: AvatarPerformanceCue;
        prosody?: AvatarProsodyCue;
      })
    | (AvatarTurnEvent & {
        type: 'avatar.speech.segment';
        text: string;
        cue: AvatarPerformanceCue;
        prosody?: AvatarProsodyCue;
      })
    | (AvatarTurnEvent & {
        type: 'avatar.speech.started';
      })
    | (AvatarTurnEvent & {
        type: 'avatar.audio.started';
        streamId: string;
        format: 'wav_stream';
        encoding: 'base64';
        source: 'live' | 'buffered';
        maxChunkBytes: number;
      })
    | (AvatarTurnEvent & {
        type: 'avatar.audio.chunk';
        format: 'wav_stream';
        chunkIndex: number;
        data: string;
        /** Additive V1 fields: older clients can keep using chunkIndex+data. */
        streamId?: string;
        byteOffset?: number;
        byteLength?: number;
      })
    | (AvatarTurnEvent & {
        type: 'avatar.audio.ended';
        streamId: string;
        totalBytes: number;
        chunks: number;
        outcome: 'complete' | 'interrupted' | 'failed';
      })
    | (AvatarTurnEvent & {
        type: 'avatar.speech.completed';
        text: string;
        durationMs: number;
      })
    | (AvatarTurnEvent & {
        type: 'avatar.speech.interrupted';
        reason: 'barge_in' | 'cancelled';
      })
    | (AvatarTurnEvent & {
        type: 'avatar.speech.failed';
        reason: 'generation' | 'synthesis' | 'playback' | 'unknown';
      })
    | (AvatarTurnEvent & {
        type: 'avatar.turn.silent';
      })
  );

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type AvatarEventInput = DistributiveOmit<AvatarEvent, keyof AvatarEventMetadata>;

export type AvatarPlaybackPhase = 'idle' | 'thinking' | 'ready' | 'speaking' | 'interrupted';

export interface AvatarPlaybackState {
  phase: AvatarPlaybackPhase;
  turnId?: string;
  cue?: AvatarPerformanceCue;
  text: string;
  lastSequence: number;
}

export interface AvatarSyncState {
  events: AvatarEvent[];
  latestSequence: number;
  ignoredTurnIds?: string[];
}

const AFFECT_BY_EMOTION: Record<Emotion, AvatarAffect> = {
  frustration: 'concerned',
  sadness: 'concerned',
  anxiety: 'attentive',
  tired: 'attentive',
  affection: 'warm',
  gratitude: 'warm',
  joy: 'joyful',
  joking: 'playful',
  'deep-talk': 'thoughtful',
  neutral: 'neutral',
};

function clampIntensity(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function avatarDeliveryCue(delivery: AvatarDeliveryInput | undefined): AvatarDeliveryCue | undefined {
  if (!delivery) return undefined;
  const pace = ['slow', 'balanced', 'brisk'].includes(delivery.pace)
    ? delivery.pace
    : 'balanced';
  const pauseStyle = ['reflective', 'natural', 'light'].includes(delivery.pauseStyle)
    ? delivery.pauseStyle
    : 'natural';
  const responseShape = ['compact', 'balanced', 'expanded'].includes(delivery.responseShape)
    ? delivery.responseShape
    : 'balanced';
  const confidence = ['low', 'medium', 'high'].includes(delivery.confidence)
    ? delivery.confidence
    : 'low';
  const targetWpm = Number.isFinite(delivery.targetWpm)
    ? Math.round(Math.max(105, Math.min(195, delivery.targetWpm)))
    : 155;
  return {
    pace,
    pauseStyle,
    responseShape,
    confidence,
    targetWpm,
    sentencePauseMs: pace === 'slow' ? 360 : pace === 'brisk' ? 140 : 240,
  };
}

export function createAvatarTurnId(): string {
  return randomUUID();
}

/** Split raw WAV bytes into Gateway-safe pieces without changing their order. */
export function splitAvatarAudioChunk(
  input: Uint8Array,
  maxBytes = MAX_AVATAR_AUDIO_CHUNK_BYTES
): Uint8Array[] {
  const size = Math.max(1024, Math.min(MAX_AVATAR_AUDIO_CHUNK_BYTES, Math.floor(maxBytes)));
  if (input.byteLength === 0) return [];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < input.byteLength; offset += size) {
    chunks.push(input.subarray(offset, Math.min(input.byteLength, offset + size)));
  }
  return chunks;
}

/** Map a conversational turn to restrained performance direction for MetaHuman. */
export function planAvatarPerformance(
  heard: string,
  delivery?: AvatarDeliveryInput,
): AvatarPerformanceCue {
  const emotion = detectEmotion(heard);
  const conversation = planConversationResponse(heard);
  let affect = AFFECT_BY_EMOTION[emotion.emotion];
  if (affect === 'neutral' && conversation.depth === 'deliberative') affect = 'thoughtful';
  if (affect === 'neutral' && conversation.analysis.act === 'agreement') affect = 'warm';
  if (affect === 'neutral' && conversation.analysis.act === 'disagreement') affect = 'confident';

  const gesture: AvatarGesture = (() => {
    if (conversation.analysis.act === 'agreement') return 'small_nod';
    if (conversation.analysis.act === 'clarification') return 'head_tilt';
    if (conversation.analysis.act === 'disagreement') return 'open_palm';
    if (conversation.depth === 'deliberative') return 'thinking_glance';
    if (conversation.analysis.act === 'opinion') return 'soft_shrug';
    return 'none';
  })();
  const speakingStyle: AvatarPerformanceCue['speakingStyle'] =
    conversation.depth === 'brief'
      ? 'brief'
      : conversation.depth === 'deliberative'
        ? 'deliberative'
        : conversation.depth === 'developed'
          ? 'reflective'
          : 'conversational';
  const deliveryCue = avatarDeliveryCue(delivery);
  const backchannel: AvatarBackchannel = affect === 'concerned' || emotion.emotion === 'anxiety'
    ? 'concerned_ack'
    : affect === 'warm' || affect === 'joyful'
      ? 'warm_ack'
      : conversation.analysis.act === 'question' || conversation.analysis.act === 'clarification'
        ? 'attentive_nod'
        : 'none';

  return {
    affect,
    intensity: clampIntensity(
      emotion.intensity === 'high' ? 0.78 : affect === 'neutral' ? 0.35 : 0.58
    ),
    gesture,
    gaze: gesture === 'thinking_glance' ? 'thinking_away' : 'user',
    speakingStyle,
    backchannel,
    ...(deliveryCue ? { delivery: deliveryCue } : {}),
  };
}

/** Per-segment facial/acoustic timing direction for MetaHuman. */
export function planAvatarSpeechProsody(
  text: string,
  cue: AvatarPerformanceCue,
): AvatarProsodyCue {
  const trimmed = text.trim();
  const question = /\?$/.test(trimmed);
  const exclamation = /!$/.test(trimmed);
  const reflective = cue.speakingStyle === 'deliberative' || cue.speakingStyle === 'reflective';
  return {
    onset: cue.affect === 'concerned'
      || cue.affect === 'warm'
      || cue.backchannel === 'concerned_ack'
      || cue.backchannel === 'warm_ack'
      ? 'gentle'
      : reflective
        ? 'reflective'
        : 'direct',
    emphasis: exclamation || (cue.intensity >= 0.72 && cue.backchannel !== 'concerned_ack')
      ? 'strong'
      : question
        ? 'light'
        : 'normal',
    breathBeforeMs: reflective ? 180 : cue.speakingStyle === 'brief' ? 40 : 90,
    terminalPauseMs: question
      ? 280
      : cue.delivery?.sentencePauseMs ?? (reflective ? 320 : 220),
  };
}

/**
 * Reference consumer state machine. Unreal can mirror this transition table so
 * a stale completion never restarts or finishes an interrupted animation.
 */
export class AvatarPlaybackStateMachine {
  private state: AvatarPlaybackState = { phase: 'idle', text: '', lastSequence: -1 };
  private readonly ignoredTurnIds = new Set<string>();

  /**
   * Apply a reconnect snapshot. Unfinished turns are explicitly ignored until
   * their terminal event, because their non-replayable audio was already lost.
   */
  applySync(sync: AvatarSyncState): AvatarPlaybackState {
    this.state = { phase: 'idle', text: '', lastSequence: -1 };
    this.ignoredTurnIds.clear();
    for (const turnId of sync.ignoredTurnIds ?? []) this.ignoredTurnIds.add(turnId);
    for (const event of sync.events) this.consume(event);
    this.state.lastSequence = Math.max(this.state.lastSequence, sync.latestSequence);
    return this.snapshot();
  }

  consume(event: AvatarEvent): AvatarPlaybackState {
    if (event.sequence <= this.state.lastSequence) return this.snapshot();
    if (this.ignoredTurnIds.has(event.turnId)) {
      if (
        event.type === 'avatar.speech.completed' ||
        event.type === 'avatar.speech.interrupted' ||
        event.type === 'avatar.speech.failed' ||
        event.type === 'avatar.turn.silent'
      ) {
        this.ignoredTurnIds.delete(event.turnId);
      }
      this.state.lastSequence = event.sequence;
      return this.snapshot();
    }
    const isActiveTurn = !this.state.turnId || this.state.turnId === event.turnId;
    if (!isActiveTurn && event.type !== 'avatar.turn.started') return this.snapshot();
    if (this.state.phase === 'interrupted' && event.type !== 'avatar.turn.started') {
      return this.snapshot();
    }

    switch (event.type) {
      case 'avatar.turn.started':
        this.state = {
          phase: 'thinking',
          turnId: event.turnId,
          cue: event.cue,
          text: '',
          lastSequence: event.sequence,
        };
        break;
      case 'avatar.speech.prepared':
        this.state = {
          ...this.state,
          phase: 'ready',
          text: event.text,
          cue: event.cue,
          lastSequence: event.sequence,
        };
        break;
      case 'avatar.speech.segment':
        this.state = {
          ...this.state,
          phase: this.state.phase === 'speaking' ? 'speaking' : 'ready',
          text: [this.state.text.trimEnd(), event.text.trimStart()].filter(Boolean).join(' '),
          cue: event.cue,
          lastSequence: event.sequence,
        };
        break;
      case 'avatar.speech.started':
        this.state = { ...this.state, phase: 'speaking', lastSequence: event.sequence };
        break;
      case 'avatar.audio.started':
      case 'avatar.audio.chunk':
      case 'avatar.audio.ended':
        this.state = { ...this.state, lastSequence: event.sequence };
        break;
      case 'avatar.speech.interrupted':
        this.state = { ...this.state, phase: 'interrupted', lastSequence: event.sequence };
        break;
      case 'avatar.speech.completed':
      case 'avatar.speech.failed':
      case 'avatar.turn.silent':
        this.state = { phase: 'idle', text: '', lastSequence: event.sequence };
        break;
    }
    return this.snapshot();
  }

  snapshot(): AvatarPlaybackState {
    return {
      ...this.state,
      ...(this.state.cue
        ? {
            cue: {
              ...this.state.cue,
              ...(this.state.cue.delivery
                ? { delivery: { ...this.state.cue.delivery } }
                : {}),
            },
          }
        : {}),
    };
  }
}
