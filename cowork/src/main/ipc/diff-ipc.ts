/**
 * `diff.*` IPC — the hunk-level diff accept/reject surface (Claude Cowork
 * parity Phase 3 step 1): parseHunks turns a unified-diff excerpt into
 * structured hunks; revertHunks applies the selected hunks back onto a file.
 * Thin layer over the hunk-diff-service.
 *
 * Extracted from the main index.ts god-file. Fully self-contained — the
 * parser/applier are importable module functions, so no accessor injection.
 * Bodies copied verbatim.
 *
 * @module main/ipc/diff-ipc
 */

import { ipcMain } from 'electron';
import { parseUnifiedDiff, revertHunks, type ParsedHunk } from '../diff/hunk-diff-service';
import { logError } from '../utils/logger';

export function registerDiffIpcHandlers(): void {
  // Hunk diff accept/reject — Claude Cowork parity Phase 3 step 1
  ipcMain.handle('diff.parseHunks', async (_event, excerpt: string) => {
    try {
      return parseUnifiedDiff(excerpt ?? '');
    } catch (err) {
      logError('[diff.parseHunks] failed:', err);
      return { hunks: [], preamble: '' };
    }
  });

  ipcMain.handle('diff.revertHunks', async (_event, filePath: string, hunks: ParsedHunk[]) => {
    try {
      if (!filePath || !Array.isArray(hunks)) {
        return { success: false, method: 'none', error: 'Invalid arguments' };
      }
      return revertHunks(filePath, hunks);
    } catch (err) {
      logError('[diff.revertHunks] failed:', err);
      return {
        success: false,
        method: 'none',
        error: (err as Error).message ?? 'Unknown error',
      };
    }
  });
}
