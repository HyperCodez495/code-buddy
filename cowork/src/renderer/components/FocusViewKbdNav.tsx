/**
 * FocusViewKbdNav — P5.6
 *
 * Drop-in hook component that adds keyboard navigation to the existing
 * FocusView: ← / → walk between messages in the active session, Cmd/Ctrl+0
 * resets to first message, Cmd/Ctrl+End jumps to the last one.
 */
import { useEffect } from 'react';
import { useAppStore } from '../store';

export function FocusViewKbdNav() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const store = useAppStore.getState();
      if (!store.showFocusView) return;
      const target = e.target as HTMLElement | null;
      // Ignore typing in input/textarea
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      const activeId = store.activeSessionId;
      if (!activeId) return;
      const messages = store.sessionStates[activeId]?.messages ?? [];
      if (messages.length === 0) return;

      const current = store.focusedMessageTarget;
      const currentIdx = current ? messages.findIndex((m) => m.id === current.messageId) : -1;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const next = messages[Math.min(messages.length - 1, currentIdx + 1)];
        if (next) store.setFocusedMessageTarget({ sessionId: activeId, messageId: next.id });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = messages[Math.max(0, currentIdx - 1)];
        if (prev) store.setFocusedMessageTarget({ sessionId: activeId, messageId: prev.id });
      } else if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        const first = messages[0];
        if (first) store.setFocusedMessageTarget({ sessionId: activeId, messageId: first.id });
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'End') {
        e.preventDefault();
        const last = messages[messages.length - 1];
        if (last) store.setFocusedMessageTarget({ sessionId: activeId, messageId: last.id });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
