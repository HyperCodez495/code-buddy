/**
 * `backup.*` IPC — `.codebuddy/` backup management from the GUI, sharing the
 * same core handlers as the `buddy backup` CLI: list/create/verify/restore.
 * Thin pass-through to the backup-bridge helpers.
 *
 * Extracted from the main index.ts god-file. Fully self-contained — the four
 * helpers are importable module functions, so no accessor injection. Bodies
 * copied verbatim.
 *
 * @module main/ipc/backup-ipc
 */

import { ipcMain } from 'electron';
import {
  createBackupForReview,
  listBackupsForReview,
  restoreBackupForReview,
  verifyBackupForReview,
} from '../tools/backup-bridge';

export function registerBackupIpcHandlers(): void {
  // ── .codebuddy/ backups (same core handler as `buddy backup`) ────────────
  ipcMain.handle('backup.list', async () => listBackupsForReview());
  ipcMain.handle('backup.create', async (_event, options?: { onlyConfig?: boolean }) =>
    createBackupForReview(options ?? {})
  );
  ipcMain.handle('backup.verify', async (_event, file: string) => verifyBackupForReview(file));
  ipcMain.handle('backup.restore', async (_event, file: string) => restoreBackupForReview(file));
}
