/**
 * `reasoning.*` IPC — the reasoning-trace viewer (Claude Cowork parity
 * Phase 3 step 17): listTraces/getTrace/clear. The reasoning-bridge is
 * imported lazily inside each handler.
 *
 * Extracted from the main index.ts god-file. Fully self-contained — no
 * mutable capture, so no accessor injection. Bodies copied verbatim.
 *
 * @module main/ipc/reasoning-ipc
 */

import { ipcMain } from 'electron';
import { logError } from '../utils/logger';

export function registerReasoningIpcHandlers(): void {
  // Reasoning trace viewer — Claude Cowork parity Phase 3 step 17
  ipcMain.handle('reasoning.listTraces', async () => {
    try {
      const { getReasoningBridge } = await import('../reasoning/reasoning-bridge');
      return getReasoningBridge().listTraces();
    } catch (err) {
      logError('[reasoning.listTraces] failed:', err);
      return [];
    }
  });

  ipcMain.handle('reasoning.getTrace', async (_event, toolUseId: string) => {
    try {
      const { getReasoningBridge } = await import('../reasoning/reasoning-bridge');
      return getReasoningBridge().getTrace(toolUseId);
    } catch (err) {
      logError('[reasoning.getTrace] failed:', err);
      return null;
    }
  });

  ipcMain.handle('reasoning.clear', async () => {
    try {
      const { getReasoningBridge } = await import('../reasoning/reasoning-bridge');
      getReasoningBridge().clear();
      return { success: true };
    } catch (_err) {
      return { success: false };
    }
  });
}
