import { ipcMain } from 'electron';
import { resolve } from 'path';
import { log, logError } from '../utils/logger';

// ── Permission mode IPC handler ───────────────────────────────────────
export function registerPermissionIpcHandlers() {
  ipcMain.handle('permission.setMode', async (_event, mode: string) => {
    // Never swallow failures here: this is the autonomy/permission POSTURE. A
    // silently-failed setMode leaves the user believing the mode changed when it
    // didn't — a false-safety failure. Callers get an honest {ok, error}.
    try {
      const enginePath = process.env.CODEBUDDY_ENGINE_PATH;
      if (!enginePath) {
        logError('[IPC] permission.setMode failed: CODEBUDDY_ENGINE_PATH not configured');
        return { ok: false, error: 'engine path not configured' };
      }
      const { getPermissionModeManager } = await import(
        /* webpackIgnore: true */ resolve(enginePath, 'security', 'permission-modes.js')
      );
      getPermissionModeManager().setMode(mode);
      log('[IPC] Permission mode set to:', mode);
      return { ok: true };
    } catch (err) {
      logError('[IPC] permission.setMode failed:', err instanceof Error ? err.message : err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
