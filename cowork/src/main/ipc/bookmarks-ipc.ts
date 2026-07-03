/**
 * `bookmarks.*` IPC — starred/bookmarked messages (Claude Cowork parity
 * Phase 3 step 4): toggle/list/forSession/updateNote/remove. Thin layer over
 * {@link BookmarksService}.
 *
 * Extracted from the main index.ts god-file. `bookmarksService` is a runtime
 * mutable (built when the DB opens), so it is injected as an ACCESSOR
 * (getter) — the handlers read the current instance and no-op with a safe
 * default while it is still null. Bodies copied verbatim.
 *
 * @module main/ipc/bookmarks-ipc
 */

import { ipcMain } from 'electron';
import type { BookmarksService } from '../bookmarks/bookmarks-service';
import { logError } from '../utils/logger';

export interface BookmarksIpcDeps {
  /** Current BookmarksService (null until the DB is open) — accessor. */
  getBookmarksService: () => BookmarksService | null;
}

export function registerBookmarksIpcHandlers(deps: BookmarksIpcDeps): void {
  const { getBookmarksService } = deps;

  // Starred/bookmarked messages — Claude Cowork parity Phase 3 step 4
  ipcMain.handle(
    'bookmarks.toggle',
    async (
      _event,
      entry: {
        sessionId: string;
        projectId?: string | null;
        messageId: string;
        preview: string;
        role?: string;
      }
    ) => {
      try {
        const bookmarksService = getBookmarksService();
        if (!bookmarksService) return { bookmarked: false };
        return bookmarksService.toggle(entry);
      } catch (err) {
        logError('[bookmarks.toggle] failed:', err);
        return { bookmarked: false };
      }
    }
  );

  ipcMain.handle('bookmarks.list', async (_event, projectId?: string | null, limit?: number) => {
    try {
      const bookmarksService = getBookmarksService();
      if (!bookmarksService) return [];
      return bookmarksService.list(projectId ?? null, limit ?? 100);
    } catch (err) {
      logError('[bookmarks.list] failed:', err);
      return [];
    }
  });

  ipcMain.handle('bookmarks.forSession', async (_event, sessionId: string) => {
    try {
      const bookmarksService = getBookmarksService();
      if (!bookmarksService) return [];
      return bookmarksService.getBookmarkedMessageIds(sessionId);
    } catch (_err) {
      return [];
    }
  });

  ipcMain.handle('bookmarks.updateNote', async (_event, id: number, note: string) => {
    try {
      const bookmarksService = getBookmarksService();
      if (!bookmarksService) return { success: false };
      return { success: bookmarksService.updateNote(id, note) };
    } catch (_err) {
      return { success: false };
    }
  });

  ipcMain.handle('bookmarks.remove', async (_event, id: number) => {
    try {
      const bookmarksService = getBookmarksService();
      if (!bookmarksService) return { success: false };
      return { success: bookmarksService.remove(id) };
    } catch (_err) {
      return { success: false };
    }
  });
}
