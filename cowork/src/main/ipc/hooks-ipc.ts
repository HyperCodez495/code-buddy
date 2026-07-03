/**
 * `hooks.*` IPC — the lifecycle-hooks editor (Claude Cowork parity Phase 3
 * step 13): list/upsert/remove and a dry-run `test` of a single handler.
 * The hooks-bridge is imported lazily inside each handler.
 *
 * Extracted from the main index.ts god-file. Fully self-contained — no
 * mutable capture, so no accessor injection. Bodies copied verbatim.
 *
 * @module main/ipc/hooks-ipc
 */

import { ipcMain } from 'electron';
import { logError } from '../utils/logger';

export function registerHooksIpcHandlers(): void {
  // Hooks editor — Claude Cowork parity Phase 3 step 13
  ipcMain.handle('hooks.list', async () => {
    try {
      const { getHooksBridge } = await import('../hooks/hooks-bridge');
      return await getHooksBridge().list();
    } catch (err) {
      logError('[hooks.list] failed:', err);
      return [];
    }
  });

  ipcMain.handle(
    'hooks.upsert',
    async (_event, params: { event: string; handler: Record<string, unknown>; index?: number }) => {
      try {
        const { getHooksBridge } = await import('../hooks/hooks-bridge');
        return await getHooksBridge().upsert(
          params.event as never,
          params.handler as never,
          params.index
        );
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }
  );

  ipcMain.handle('hooks.remove', async (_event, params: { event: string; index: number }) => {
    try {
      const { getHooksBridge } = await import('../hooks/hooks-bridge');
      return await getHooksBridge().remove(params.event as never, params.index);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('hooks.test', async (_event, handler: Record<string, unknown>) => {
    try {
      const { getHooksBridge } = await import('../hooks/hooks-bridge');
      return await getHooksBridge().test(handler as never);
    } catch (err) {
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        error: (err as Error).message,
      };
    }
  });
}
