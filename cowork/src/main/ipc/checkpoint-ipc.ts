/**
 * `checkpoint.*` IPC — the ghost-snapshot timeline (list/undo/redo/restore)
 * plus a git-commit `compare`. The snapshot manager lives in the CLI engine
 * bundle, loaded lazily via `CODEBUDDY_ENGINE_PATH`; every handler no-ops to
 * null when the engine path is unset. `compare` is delegated to the
 * {@link getGitBridge} singleton.
 *
 * Extracted from the main index.ts god-file. Fully self-contained — all
 * dependencies (path.resolve, the dynamic engine import, getGitBridge,
 * logError) are importable, so no accessor injection. Bodies verbatim.
 *
 * @module main/ipc/checkpoint-ipc
 */

import { ipcMain } from 'electron';
import { resolve } from 'path';
import { getGitBridge } from '../git/git-bridge';
import { logError } from '../utils/logger';

export function registerCheckpointIpcHandlers(): void {
  ipcMain.handle('checkpoint.list', async () => {
    try {
      const enginePath = process.env.CODEBUDDY_ENGINE_PATH;
      if (!enginePath) return null;
      const { getGhostSnapshotManager } = await import(
        /* webpackIgnore: true */ resolve(enginePath, 'checkpoints', 'ghost-snapshot.js')
      );
      const gsm = getGhostSnapshotManager();
      return gsm.getTimeline();
    } catch {
      return null;
    }
  });

  ipcMain.handle('checkpoint.undo', async () => {
    try {
      const enginePath = process.env.CODEBUDDY_ENGINE_PATH;
      if (!enginePath) return null;
      const { getGhostSnapshotManager } = await import(
        /* webpackIgnore: true */ resolve(enginePath, 'checkpoints', 'ghost-snapshot.js')
      );
      const gsm = getGhostSnapshotManager();
      return await gsm.undoLastTurn();
    } catch {
      return null;
    }
  });

  ipcMain.handle('checkpoint.redo', async () => {
    try {
      const enginePath = process.env.CODEBUDDY_ENGINE_PATH;
      if (!enginePath) return null;
      const { getGhostSnapshotManager } = await import(
        /* webpackIgnore: true */ resolve(enginePath, 'checkpoints', 'ghost-snapshot.js')
      );
      const gsm = getGhostSnapshotManager();
      return await gsm.redoLastTurn();
    } catch {
      return null;
    }
  });

  ipcMain.handle('checkpoint.restore', async (_event, snapshotId: string) => {
    try {
      const enginePath = process.env.CODEBUDDY_ENGINE_PATH;
      if (!enginePath) return null;
      const { getGhostSnapshotManager } = await import(
        /* webpackIgnore: true */ resolve(enginePath, 'checkpoints', 'ghost-snapshot.js')
      );
      const gsm = getGhostSnapshotManager();
      return await gsm.restoreSnapshot(snapshotId);
    } catch {
      return null;
    }
  });

  ipcMain.handle(
    'checkpoint.compare',
    async (_event, cwd: string, fromCommit: string, toCommit: string) => {
      try {
        if (!cwd || !fromCommit || !toCommit) return [];
        return getGitBridge().compareCommits(cwd, fromCommit, toCommit);
      } catch (err) {
        logError('[checkpoint.compare] failed:', err);
        return [];
      }
    }
  );
}
