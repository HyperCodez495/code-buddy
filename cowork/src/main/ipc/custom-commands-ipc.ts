/**
 * `customCommands.*` IPC — user-defined slash commands (Claude Cowork parity
 * Phase 3 step 6): list/save/delete. Thin layer over the
 * {@link getCustomCommandsService} singleton.
 *
 * Extracted from the main index.ts god-file. Fully self-contained — the
 * service is an importable singleton, so no accessor injection. Bodies
 * copied verbatim.
 *
 * @module main/ipc/custom-commands-ipc
 */

import { ipcMain } from 'electron';
import { getCustomCommandsService } from '../commands/custom-commands-service';
import { logError } from '../utils/logger';

export function registerCustomCommandsIpcHandlers(): void {
  // Custom slash commands — Claude Cowork parity Phase 3 step 6
  ipcMain.handle('customCommands.list', async () => {
    try {
      return getCustomCommandsService().list();
    } catch (err) {
      logError('[customCommands.list] failed:', err);
      return [];
    }
  });

  ipcMain.handle(
    'customCommands.save',
    async (_event, cmd: { name: string; description: string; body: string }) => {
      try {
        return getCustomCommandsService().save(cmd);
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }
  );

  ipcMain.handle('customCommands.delete', async (_event, name: string) => {
    try {
      return getCustomCommandsService().delete(name);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
