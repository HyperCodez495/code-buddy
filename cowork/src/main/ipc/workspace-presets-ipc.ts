/**
 * `workspacePresets.*` IPC — saved workspace layout presets (Claude Cowork
 * parity Phase 3 step 9): list/save/delete. Thin layer over the
 * {@link getWorkspacePresetsService} singleton.
 *
 * Extracted from the main index.ts god-file. Fully self-contained — the
 * service is an importable singleton, so no accessor injection. Bodies
 * copied verbatim.
 *
 * @module main/ipc/workspace-presets-ipc
 */

import { ipcMain } from 'electron';
import {
  getWorkspacePresetsService,
  type WorkspacePreset,
} from '../workspace/workspace-presets-service';
import { logError } from '../utils/logger';

export function registerWorkspacePresetsIpcHandlers(): void {
  // Workspace presets — Claude Cowork parity Phase 3 step 9
  ipcMain.handle('workspacePresets.list', async () => {
    try {
      return getWorkspacePresetsService().list();
    } catch (err) {
      logError('[workspacePresets.list] failed:', err);
      return [];
    }
  });

  ipcMain.handle(
    'workspacePresets.save',
    async (
      _event,
      preset: Omit<WorkspacePreset, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
    ) => {
      try {
        return getWorkspacePresetsService().save(preset);
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }
  );

  ipcMain.handle('workspacePresets.delete', async (_event, id: string) => {
    try {
      return getWorkspacePresetsService().delete(id);
    } catch (_err) {
      return { success: false };
    }
  });
}
