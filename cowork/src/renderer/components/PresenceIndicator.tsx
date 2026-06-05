/**
 * PresenceIndicator — minimal status badge for the Cowork header.
 *
 * Polls `presence:list` to know if any identities are enrolled, and
 * subscribes (via the Zustand store, fed by PresenceService) to live
 * presence events. Renders, in priority order (copy is i18n via the
 * `presence.*` keys):
 *   1. A success dot + name when the camera currently sees a known person.
 *   2. A neutral "unknown" badge when a face is detected but doesn't match
 *      any enrolled identity.
 *   3. An "enroll a face" prompt when nobody is enrolled yet.
 *   4. A discreet "N faces enrolled" fallback otherwise.
 *
 * Clicking the indicator always opens `EnrollmentDialog`.
 *
 * @module cowork/renderer/components/PresenceIndicator
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
        className="flex items-center gap-1.5 text-xs text-success hover:opacity-80"
        title={t('presence.recognizedTitle', '{{name}} recognized ({{pct}}%) — click to manage identities', {
          name: currentPresence.name,
          pct,
        })}
      >
        <span className="relative inline-flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
        </span>
        <span>👋 {currentPresence.name}</span>
        <span className="text-success/60">({pct}%)</span>
      </button>
    );
  }

  // 2. Unknown face — somebody is there but doesn't match anyone enrolled.
  if (lastEventType === 'unknown') {
    return (
      <button
        onClick={onEnrollClicked}
        className="flex items-center gap-1 text-xs text-warning hover:opacity-80"
        title={t('presence.unknownTitle', 'Unknown face detected — click to enroll it')}
      >
        <span>👤 {t('presence.unknown', 'unknown')}</span>
      </button>
    );
  }

  if (enrolled === null) return null; // initial load — render nothing
  if (enrolled.length === 0) {
    // 3. Nobody enrolled yet.
    return (
      <button
        onClick={onEnrollClicked}
        className="text-xs text-text-muted hover:text-text-secondary"
        title={t('presence.noneEnrolledTitle', 'No face enrolled — click to enroll yours')}
      >
        👤 {t('presence.enrollFace', 'Register a face')}
      </button>
    );
  }

  // 4. Enrolled but nobody currently in front of the camera (or no live
  //    event yet — the service may still be warming up).
  return (
    <button
      onClick={onEnrollClicked}
      className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary"
      title={t('presence.enrollAnotherTitle', 'Click to enroll another face')}
    >
      <span>👤</span>
      <span>{t('presence.enrolledCount', { count: enrolled.length })}</span>
    </button>
  );
}
