/**
 * useBargeInTurnCancel — Part B of automatic barge-in.
 *
 * Cutting the TTS is not enough: when the user barges in, the agent turn is
 * still running in the main process (the LLM keeps generating, wasting compute,
 * and a "ghost" reply can land after the interruption). This hook listens for
 * the `cowork:voice-interrupted` event (dispatched by `interruptSpeech`) and,
 * when the reason is `barge_in`, cancels the active session's turn by reusing
 * the existing stop-turn path (`useIPC.stopSession` → `session.stop` →
 * `SessionManager.stopSession` → `agentRunner.cancel()` + `AbortController.abort()`).
 *
 * Covers BOTH triggers uniformly: the new VAD auto-barge-in AND the existing
 * push-to-talk (which also dispatches `barge_in`). never-throws.
 *
 * @module renderer/hooks/useBargeInTurnCancel
 */

import { useEffect, useRef } from 'react';

export interface BargeInCancelDecision {
  cancel: boolean;
  sessionId: string | null;
}

/**
 * Pure decision: given an interruption reason and the active session id, should
 * we cancel a turn and for which session? Extracted for direct unit testing.
 */
export function resolveBargeInCancel(
  reason: string | undefined,
  activeSessionId: string | null | undefined,
): BargeInCancelDecision {
  if (reason !== 'barge_in' || !activeSessionId) {
    return { cancel: false, sessionId: activeSessionId ?? null };
  }
  return { cancel: true, sessionId: activeSessionId };
}

/**
 * Mount once (e.g. in App) with the current active session id and the IPC
 * stop-turn action. On a `barge_in` interruption it cancels the running turn.
 */
export function useBargeInTurnCancel(
  activeSessionId: string | null | undefined,
  stopSession: (sessionId: string) => void,
): void {
  // Keep the latest values in refs so the window listener (bound once) always
  // sees the current session without re-subscribing on every render.
  const sessionRef = useRef<string | null | undefined>(activeSessionId);
  const stopRef = useRef(stopSession);
  sessionRef.current = activeSessionId;
  stopRef.current = stopSession;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onInterrupted = (e: Event) => {
      const detail = (e as CustomEvent<{ reason?: string }>).detail;
      const decision = resolveBargeInCancel(detail?.reason, sessionRef.current);
      if (decision.cancel && decision.sessionId) {
        try {
          stopRef.current(decision.sessionId);
        } catch {
          /* never-throws — cancelling a turn must not crash the UI */
        }
      }
    };
    window.addEventListener('cowork:voice-interrupted', onInterrupted as EventListener);
    return () =>
      window.removeEventListener('cowork:voice-interrupted', onInterrupted as EventListener);
  }, []);
}
