export type VoiceConversationPhase =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'error';

export type VoiceConversationEventType =
  | 'listening_started'
  | 'listening_stopped'
  | 'transcription_started'
  | 'transcription_completed'
  | 'transcription_failed'
  | 'user_message_sent'
  | 'assistant_speech_started'
  | 'assistant_speech_finished'
  | 'assistant_interrupted'
  | 'reset';

export interface VoiceConversationEvent {
  type: VoiceConversationEventType;
  timestamp?: number;
  transcript?: string;
  error?: string;
  reason?: string;
  hadPlayback?: boolean;
}

export interface VoiceConversationSnapshot {
  phase: VoiceConversationPhase;
  startedAt: number;
  updatedAt: number;
  lastEventType?: VoiceConversationEventType;
  turnId: number;
  interruptionCount: number;
  lastTranscriptPreview?: string;
  lastError?: string;
  lastInterruptionReason?: string;
  hadPlaybackDuringLastInterruption?: boolean;
}

function nowMs(): number {
  return Date.now();
}

function preview(text: string | undefined): string | undefined {
  const compact = (text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  return compact.length <= 240 ? compact : `${compact.slice(0, 237)}...`;
}

export class VoiceConversationSession {
  private state: VoiceConversationSnapshot;

  constructor(now: number = nowMs()) {
    this.state = {
      phase: 'idle',
      startedAt: now,
      updatedAt: now,
      turnId: 0,
      interruptionCount: 0,
    };
  }

  snapshot(): VoiceConversationSnapshot {
    return { ...this.state };
  }

  record(event: VoiceConversationEvent): VoiceConversationSnapshot {
    const timestamp = event.timestamp ?? nowMs();
    if (event.type === 'reset') {
      this.state = {
        phase: 'idle',
        startedAt: timestamp,
        updatedAt: timestamp,
        lastEventType: event.type,
        turnId: 0,
        interruptionCount: 0,
      };
      return this.snapshot();
    }

    const next: VoiceConversationSnapshot = {
      ...this.state,
      updatedAt: timestamp,
      lastEventType: event.type,
    };

    switch (event.type) {
      case 'listening_started':
        next.phase = 'listening';
        next.turnId += 1;
        next.lastError = undefined;
        break;
      case 'listening_stopped':
      case 'transcription_started':
        next.phase = 'transcribing';
        break;
      case 'transcription_completed':
        next.phase = 'thinking';
        next.lastTranscriptPreview = preview(event.transcript);
        next.lastError = undefined;
        break;
      case 'transcription_failed':
        next.phase = 'error';
        next.lastError = event.error || 'transcription failed';
        break;
      case 'user_message_sent':
        next.phase = 'thinking';
        next.lastTranscriptPreview = preview(event.transcript) ?? next.lastTranscriptPreview;
        break;
      case 'assistant_speech_started':
        next.phase = 'speaking';
        next.lastError = undefined;
        break;
      case 'assistant_speech_finished':
        next.phase = 'idle';
        break;
      case 'assistant_interrupted':
        next.phase = 'interrupted';
        next.interruptionCount += 1;
        next.lastInterruptionReason = event.reason || 'manual';
        next.hadPlaybackDuringLastInterruption = Boolean(event.hadPlayback);
        break;
    }

    this.state = next;
    return this.snapshot();
  }
}
