/**
 * MultiWindowAction — P4.1
 *
 * Opens a new window. Tries the electron API first (window.openNew) and
 * falls back to creating a new browser-side tab via the existing tab
 * store. Bound to Cmd/Ctrl+Shift+N.
 */
import { useEffect } from 'react';
import { useAppStore } from '../store';

export function MultiWindowAction() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        const api = (window.electronAPI as unknown as { window?: { openNew?: () => Promise<void> } })?.window?.openNew;
        if (api) {
          void api();
        } else {
          // Fallback: open a new in-app tab pointing at a fresh session.
          useAppStore.getState().setActiveSession(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
