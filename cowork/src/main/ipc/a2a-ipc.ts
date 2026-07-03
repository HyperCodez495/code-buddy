/**
 * `a2a.*` IPC — the A2A remote-agent registry (Claude Cowork parity Phase 3
 * step 19): list/discover/add/remove/ping/invoke registered A2A agents plus
 * cancelTask/listTasks over their task lifecycle. The a2a-bridge is imported
 * lazily inside each handler.
 *
 * Extracted from the main index.ts god-file. Fully self-contained — no
 * mutable capture, so no accessor injection. Bodies copied verbatim.
 *
 * @module main/ipc/a2a-ipc
 */

import { ipcMain } from 'electron';
import { logError } from '../utils/logger';

export function registerA2aIpcHandlers(): void {
  // A2A remote agent registry — Claude Cowork parity Phase 3 step 19
  ipcMain.handle('a2a.list', async () => {
    try {
      const { getA2ABridge } = await import('../a2a/a2a-bridge');
      return await getA2ABridge().list();
    } catch (err) {
      logError('[a2a.list] failed:', err);
      return [];
    }
  });

  ipcMain.handle('a2a.discover', async (_event, url: string) => {
    try {
      const { getA2ABridge } = await import('../a2a/a2a-bridge');
      return await getA2ABridge().discover(url);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('a2a.add', async (_event, url: string) => {
    try {
      const { getA2ABridge } = await import('../a2a/a2a-bridge');
      return await getA2ABridge().add(url);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('a2a.remove', async (_event, id: string) => {
    try {
      const { getA2ABridge } = await import('../a2a/a2a-bridge');
      return await getA2ABridge().remove(id);
    } catch (_err) {
      return { success: false };
    }
  });

  ipcMain.handle('a2a.ping', async (_event, id: string) => {
    try {
      const { getA2ABridge } = await import('../a2a/a2a-bridge');
      return await getA2ABridge().ping(id);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('a2a.invoke', async (_event, params: { id: string; message: string }) => {
    try {
      const { getA2ABridge } = await import('../a2a/a2a-bridge');
      return await getA2ABridge().invoke(params.id, params.message);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('a2a.cancelTask', async (_event, params: { id: string; taskId: string }) => {
    try {
      const { getA2ABridge } = await import('../a2a/a2a-bridge');
      return await getA2ABridge().cancelTask(params.id, params.taskId);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('a2a.listTasks', async () => {
    try {
      const { getA2ABridge } = await import('../a2a/a2a-bridge');
      return await getA2ABridge().listTasks();
    } catch (err) {
      logError('[a2a.listTasks] failed:', err);
      return [];
    }
  });
}
