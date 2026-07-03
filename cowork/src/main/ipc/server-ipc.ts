/**
 * `server.*` IPC — boot/stop the core Code Buddy HTTP server (port 3000)
 * from the Cowork UI: status/start/stop/dashboard. The server runs
 * in-process so all bridges share state with Cowork. The server-bridge is
 * imported lazily inside each handler (avoids pulling the server graph into
 * the main bundle until first use).
 *
 * Extracted from the main index.ts god-file. Fully self-contained — no
 * mutable capture, so no accessor injection. Bodies copied verbatim.
 *
 * @module main/ipc/server-ipc
 */

import { ipcMain } from 'electron';

export function registerServerIpcHandlers(): void {
  // HTTP Server bridge — boot/stop the core Code Buddy server (port 3000)
  // from the Cowork UI. The server runs in-process so all bridges share
  // state with Cowork.
  ipcMain.handle('server.status', async () => {
    const { getServerBridge } = await import('../server/server-bridge');
    return getServerBridge().status();
  });

  ipcMain.handle(
    'server.start',
    async (_event, userConfig?: { port?: number; host?: string; websocketEnabled?: boolean }) => {
      const { getServerBridge } = await import('../server/server-bridge');
      return getServerBridge().start(userConfig ?? {});
    }
  );

  ipcMain.handle('server.stop', async () => {
    const { getServerBridge } = await import('../server/server-bridge');
    return getServerBridge().stop();
  });

  ipcMain.handle('server.dashboard', async () => {
    const { getServerBridge } = await import('../server/server-bridge');
    return getServerBridge().dashboard();
  });
}
