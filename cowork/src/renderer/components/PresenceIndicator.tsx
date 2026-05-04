/**
 * PresenceIndicator — minimal status badge for the Cowork header.
 *
 * Polls `presence:list` to know if any identities are enrolled. Renders:
 *   - Nothing when presence is fully off / nobody enrolled.
 *   - A discreet "Camera off — enroll" link when enrolled but no live
 *     match has been pushed to the bus recently.
 *   - A green dot + name when somebody was just detected.
 *
 * The actual presence loop (continuous webcam capture + detect + encode +
 * match every N seconds) is *not* in this component. That belongs in a
 * top-level service (`PresenceService` to come) so it doesn't tie its
 * lifecycle to the indicator's mount/unmount.
 *
 * V0: this component is a status reflector only — clicking it opens
 * `EnrollmentDialog`. The continuous loop will arrive in V0.5.
 *
 * @module cowork/renderer/components/PresenceIndicator
 */

import { useEffect, useState } from 'react';

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

  if (enrolled === null) return null; // initial load — render nothing
  if (enrolled.length === 0) {
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

  // V0: we only show "X visage(s) enregistré(s)" + click to add another.
  // V0.5 will subscribe to presence:detected events and show the live name + dot.
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
