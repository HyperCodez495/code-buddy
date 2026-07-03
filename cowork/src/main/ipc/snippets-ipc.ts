/**
 * `snippets.*` IPC — the snippets / prompt library (Claude Cowork parity
 * Phase 3 step 5): list/get/save/delete. Thin layer over the
 * {@link getSnippetsService} singleton.
 *
 * Extracted from the main index.ts god-file. Fully self-contained — the
 * snippets service is an importable singleton, so no accessor injection.
 * Bodies copied verbatim.
 *
 * @module main/ipc/snippets-ipc
 */

import { ipcMain } from 'electron';
import { getSnippetsService } from '../snippets/snippets-service';
import { logError } from '../utils/logger';

export function registerSnippetsIpcHandlers(): void {
  // Snippets / prompt library — Claude Cowork parity Phase 3 step 5
  ipcMain.handle('snippets.list', async () => {
    try {
      return getSnippetsService().list();
    } catch (err) {
      logError('[snippets.list] failed:', err);
      return [];
    }
  });

  ipcMain.handle('snippets.get', async (_event, id: string) => {
    try {
      return getSnippetsService().get(id);
    } catch (_err) {
      return null;
    }
  });

  ipcMain.handle(
    'snippets.save',
    async (
      _event,
      snippet: {
        id?: string;
        name: string;
        description?: string;
        tags?: string[];
        body: string;
      }
    ) => {
      try {
        return getSnippetsService().save(snippet);
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }
  );

  ipcMain.handle('snippets.delete', async (_event, id: string) => {
    try {
      return getSnippetsService().delete(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
