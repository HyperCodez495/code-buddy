/**
 * useTabPinPersistence — keep the user's pinned-tab choice across
 * Cowork restarts.
 *
 * On mount: fetch `tabs.pinnedSessionIds` from configStore via
 * `electronAPI.config.get()` and apply via `setPinnedSessionIds()`.
 *
 * On subsequent changes to the openTabs list: extract the current
 * pinned-session ids and persist via `electronAPI.config.save()`. A
 * shallow-equal guard prevents redundant writes on every renderer
 * tick.
 *
 * Unread counters are intentionally NOT persisted — a notification
 * you've already seen shouldn't follow you to the next launch.
 *
 * @module renderer/hooks/useTabPinPersistence
 */
import { useEffect, useRef } from 'react';
import { useAppStore } from '../store';

export function useTabPinPersistence(): void {
  const openTabs = useAppStore((s) => s.openTabs);
  const setPinnedSessionIds = useAppStore((s) => s.setPinnedSessionIds);
  const hydratedRef = useRef(false);
  const lastSavedRef = useRef<string>(''); // serialized for cheap diff

  // One-shot hydration on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await window.electronAPI?.config?.get?.();
        if (cancelled) return;
        const stored = (cfg as { tabs?: { pinnedSessionIds?: string[] } } | undefined)
          ?.tabs?.pinnedSessionIds;
        if (Array.isArray(stored) && stored.length > 0) {
          setPinnedSessionIds(stored);
        }
        hydratedRef.current = true;
        // Seed the diff guard so we don't immediately re-write the
        // same list back as soon as the effect below fires.
        lastSavedRef.current = JSON.stringify(stored ?? []);
      } catch {
        // Silent — pin persistence is a polish feature, not load-bearing.
        hydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setPinnedSessionIds]);

  // Persist on every change once hydration is done. We serialise the
  // sorted ID list so write-through fires only on real shape changes,
  // not on order-changes or unread bumps.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const ids = openTabs
      .filter((t) => t.pinned)
      .map((t) => t.sessionId)
      .sort();
    const serialised = JSON.stringify(ids);
    if (serialised === lastSavedRef.current) return;
    lastSavedRef.current = serialised;
    void (async () => {
      try {
        await window.electronAPI?.config?.save?.({
          tabs: { pinnedSessionIds: ids },
        } as Record<string, unknown>);
      } catch {
        /* polish feature — don't break the UI on a save failure */
      }
    })();
  }, [openTabs]);
}
