/**
 * `identity.*` IPC — the persona switcher (Claude Cowork parity Phase 3 step
 * 11): list/getDetail the available personas and activate/deactivate/getActive
 * the current one, broadcasting an `identity.activated` frame to the renderer
 * on change. The identity-bridge is imported lazily inside each handler.
 *
 * Named persona-ipc to avoid clashing with the existing identity-ipc module
 * (which owns the separate `identityFiles.*` channels). Extracted from the
 * main index.ts god-file. Self-contained — the identity-bridge and
 * sendToRenderer are importable, so no accessor injection. Bodies verbatim.
 *
 * @module main/ipc/persona-ipc
 */

import { ipcMain } from 'electron';
import { sendToRenderer } from '../ipc-main-bridge';
import { logError } from '../utils/logger';

export function registerPersonaIpcHandlers(): void {
  // Persona switcher — Claude Cowork parity Phase 3 step 11
  ipcMain.handle('identity.list', async () => {
    try {
      const { getIdentityBridge } = await import('../identity/identity-bridge');
      return await getIdentityBridge().list();
    } catch (err) {
      logError('[identity.list] failed:', err);
      return [];
    }
  });

  ipcMain.handle('identity.getDetail', async (_event, id: string) => {
    try {
      const { getIdentityBridge } = await import('../identity/identity-bridge');
      return await getIdentityBridge().getDetail(id);
    } catch (err) {
      logError('[identity.getDetail] failed:', err);
      return null;
    }
  });

  ipcMain.handle('identity.activate', async (_event, id: string) => {
    try {
      const { getIdentityBridge } = await import('../identity/identity-bridge');
      const result = await getIdentityBridge().activate(id);
      if (result.success) {
        sendToRenderer({
          type: 'identity.activated',
          payload: result.active ?? null,
        });
      }
      return result;
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('identity.deactivate', async () => {
    try {
      const { getIdentityBridge } = await import('../identity/identity-bridge');
      const result = await getIdentityBridge().deactivate();
      sendToRenderer({
        type: 'identity.activated',
        payload: null,
      });
      return result;
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('identity.getActive', async () => {
    try {
      const { getIdentityBridge } = await import('../identity/identity-bridge');
      return getIdentityBridge().getActive();
    } catch (_err) {
      return null;
    }
  });
}
