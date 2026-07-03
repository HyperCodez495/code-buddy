/**
 * `clipboard.*` IPC — the Lisa-derived clipboard summariser: a one-shot
 * `summarizeNow`, a `setMonitoring` toggle (persisted to config + applied to
 * the live watcher), and a `status` read. Thin layer over
 * {@link ClipboardWatcher} + the config store.
 *
 * Extracted from the main index.ts god-file. `clipboardWatcher` is a runtime
 * mutable (created at boot), so it is injected as an ACCESSOR (getter) — the
 * handlers read the current instance. The `configStore` singleton is an
 * importable module const and needs no injection. Bodies copied verbatim.
 *
 * @module main/ipc/clipboard-ipc
 */

import { ipcMain } from 'electron';
import type { ClipboardWatcher } from '../clipboard/clipboard-watcher';
import { configStore } from '../config/config-store';

export interface ClipboardIpcDeps {
  /** Current ClipboardWatcher (null until created at boot) — accessor. */
  getClipboardWatcher: () => ClipboardWatcher | null;
}

export function registerClipboardIpcHandlers(deps: ClipboardIpcDeps): void {
  const { getClipboardWatcher } = deps;

  /**
   * Clipboard summariser (Lisa-derived). One-shot summarise of the
   * current clipboard text, regardless of length, for the "Summarize
   * Now" button.
   */
  ipcMain.handle('clipboard.summarizeNow', async () => {
    const clipboardWatcher = getClipboardWatcher();
    if (!clipboardWatcher) {
      return { ok: false, error: 'watcher not initialized' };
    }
    try {
      const payload = await clipboardWatcher.summariseNow();
      if (!payload) return { ok: false, error: 'clipboard empty or too short' };
      return { ok: true, payload };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('clipboard.setMonitoring', async (_event, enabled: boolean) => {
    const clipboardWatcher = getClipboardWatcher();
    if (!clipboardWatcher) return { ok: false };
    // Persist + apply.
    const previousConfig = configStore.getAll();
    configStore.update({
      clipboard: { ...(previousConfig.clipboard ?? {}), monitoringEnabled: enabled },
    });
    if (enabled) {
      clipboardWatcher.start();
    } else {
      clipboardWatcher.stop();
    }
    return { ok: true, running: clipboardWatcher.isRunning() };
  });

  ipcMain.handle('clipboard.status', async () => {
    const clipboardWatcher = getClipboardWatcher();
    return {
      running: clipboardWatcher?.isRunning() ?? false,
      monitoringEnabled: configStore.getAll().clipboard?.monitoringEnabled ?? false,
    };
  });
}
