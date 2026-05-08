/**
 * PresenceIndicator — minimal status badge for the Cowork header.
 *
 * Polls `presence:list` to know if any identities are enrolled, and
 * subscribes (via the Zustand store, fed by PresenceService) to live
 * presence events. Renders, in priority order:
 *   1. A green dot + name when the camera currently sees a known person.
 *   2. A neutral "👤 inconnu" when a face is detected but doesn't match
 *      any enrolled identity.
 *   3. Nothing / "Enregistrer un visage" when nobody is enrolled yet.
 *   4. A discreet "X visages enregistrés" fallback otherwise.
 *
 * Clicking the indicator always opens `EnrollmentDialog`.
 *
 * @module cowork/renderer/components/PresenceIndicator
 */

import { useEffect, useState } from 'react';
import { useAppStore } from '../store';

// Window.electronAPI.presence is declared in cowork/src/preload/index.ts.
// We narrow the shape locally because preload uses `unknown[]` for `list()`
// (the canonical PersonIdentity type lives in cowork/shared/presence/types
// but the preload contract intentionally stays loose to avoid a circular
// dependency between preload and renderer types).
interface PresenceListEntry {
  id: string;
  name: string;
  aliases: string[];
}

export interface PresenceIndicatorProps {
  /** Called when the user clicks the indicator to add a new identity. */
  onEnrollClicked: () => void;
}

export function PresenceIndicator({ onEnrollClicked }: PresenceIndicatorProps) {
  const [enrolled, setEnrolled] = useState<PresenceListEntry[] | null>(null);
  const currentPresence = useAppStore((s) => s.currentPresence);
  const lastEventType = useAppStore((s) => s.lastPresenceEventType);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const raw = (await window.electronAPI?.presence?.list()) as PresenceListEntry[] | undefined;
        if (!cancelled) setEnrolled(raw ?? []);
      } catch {
        if (!cancelled) setEnrolled([]);
      }
    };
    void refresh();
    // Re-check when the dialog likely closed (user enrolled someone).
    const interval = setInterval(refresh, 5_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // 1. Live match — somebody known is in front of the camera.
  if (currentPresence && lastEventType === 'detected') {
    const pct = Math.round(currentPresence.confidence * 100);
    return (
      <button
        onClick={onEnrollClicked}
        className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 hover:opacity-80"
        title={`${currentPresence.name} reconnu (${pct}%) — cliquer pour gérer les identités`}
      >
        <span className="relative inline-flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        <span>👋 {currentPresence.name}</span>
        <span className="text-emerald-700/60 dark:text-emerald-300/60">({pct}%)</span>
      </button>
    );
  }

  // 2. Unknown face — somebody is there but doesn't match anyone enrolled.
  if (lastEventType === 'unknown') {
    return (
      <button
        onClick={onEnrollClicked}
        className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:opacity-80"
        title="Visage inconnu détecté — cliquer pour l'enregistrer"
      >
        <span>👤 inconnu</span>
      </button>
    );
  }

  if (enrolled === null) return null; // initial load — render nothing
  if (enrolled.length === 0) {
    // 3. Nobody enrolled yet.
    return (
      <button
        onClick={onEnrollClicked}
        className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        title="Aucun visage enregistré — cliquez pour enregistrer le vôtre"
      >
        👤 Enregistrer un visage
      </button>
    );
  }

  // 4. Enrolled but nobody currently in front of the camera (or no live
  //    event yet — the service may still be warming up).
  return (
    <button
      onClick={onEnrollClicked}
      className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      title="Cliquer pour enregistrer un autre visage"
    >
      <span>👤</span>
      <span>
        {enrolled.length} visage{enrolled.length > 1 ? 's' : ''} enregistré
        {enrolled.length > 1 ? 's' : ''}
      </span>
    </button>
  );
}
