import { describe, expect, it } from 'vitest';
import { VoiceConversationSession } from '../src/main/voice/conversation-session';

describe('VoiceConversationSession', () => {
  it('tracks a full voice turn from listening to idle', () => {
    const session = new VoiceConversationSession(1000);
    expect(session.snapshot()).toMatchObject({ phase: 'idle', turnId: 0 });

    session.record({ type: 'listening_started', timestamp: 1100 });
    expect(session.snapshot()).toMatchObject({ phase: 'listening', turnId: 1 });

    session.record({ type: 'transcription_started', timestamp: 1200 });
    expect(session.snapshot().phase).toBe('transcribing');

    session.record({
      type: 'transcription_completed',
      timestamp: 1300,
      transcript: 'Bonjour Buddy, resume ma journee.',
    });
    expect(session.snapshot()).toMatchObject({
      phase: 'thinking',
      lastTranscriptPreview: 'Bonjour Buddy, resume ma journee.',
    });

    session.record({ type: 'assistant_speech_started', timestamp: 1400 });
    expect(session.snapshot().phase).toBe('speaking');

    session.record({ type: 'assistant_speech_finished', timestamp: 1500 });
    expect(session.snapshot().phase).toBe('idle');
  });

  it('records barge-in interruptions as first-class state', () => {
    const session = new VoiceConversationSession(1000);
    session.record({ type: 'assistant_speech_started', timestamp: 1100 });
    session.record({
      type: 'assistant_interrupted',
      reason: 'barge_in',
      hadPlayback: true,
      timestamp: 1200,
    });

    expect(session.snapshot()).toMatchObject({
      phase: 'interrupted',
      interruptionCount: 1,
      lastInterruptionReason: 'barge_in',
      hadPlaybackDuringLastInterruption: true,
    });
  });
});
