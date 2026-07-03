/**
 * `plugins.*` IPC — the plugin manager: listCatalog/listInstalled and
 * install/uninstall/setEnabled/setComponentEnabled. Skill-affecting changes
 * invalidate the SessionManager's skills setup so the next turn re-reads them.
 * Thin layer over {@link PluginRuntimeService}.
 *
 * Extracted from the main index.ts god-file. Reads TWO runtime mutables —
 * `pluginRuntimeService` and `sessionManager` — so both are injected as
 * ACCESSORS (getters) and read at call time. Bodies copied verbatim (unlike
 * most extracted groups these deliberately re-throw so the renderer surfaces
 * the failure).
 *
 * @module main/ipc/plugins-ipc
 */

import { ipcMain } from 'electron';
import type { PluginRuntimeService } from '../skills/plugin-runtime-service';
import type { SessionManager } from '../session/session-manager';
import { logError } from '../utils/logger';

export interface PluginsIpcDeps {
  /** Current PluginRuntimeService (null until initialized) — accessor. */
  getPluginRuntimeService: () => PluginRuntimeService | null;
  /** Current SessionManager (null until the DB is open) — accessor. */
  getSessionManager: () => SessionManager | null;
}

export function registerPluginsIpcHandlers(deps: PluginsIpcDeps): void {
  const { getPluginRuntimeService, getSessionManager } = deps;

  ipcMain.handle('plugins.listCatalog', async (_event, options?: { installableOnly?: boolean }) => {
    try {
      const pluginRuntimeService = getPluginRuntimeService();
      if (!pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      return await pluginRuntimeService.listCatalog(options);
    } catch (error) {
      logError('[Plugins] Error listing catalog:', error);
      throw error;
    }
  });

  ipcMain.handle('plugins.listInstalled', async () => {
    try {
      const pluginRuntimeService = getPluginRuntimeService();
      if (!pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      return pluginRuntimeService.listInstalled();
    } catch (error) {
      logError('[Plugins] Error listing installed plugins:', error);
      throw error;
    }
  });

  ipcMain.handle('plugins.install', async (_event, pluginName: string) => {
    try {
      const pluginRuntimeService = getPluginRuntimeService();
      if (!pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      const result = await pluginRuntimeService.install(pluginName);
      getSessionManager()?.invalidateSkillsSetup();
      return result;
    } catch (error) {
      logError('[Plugins] Error installing plugin:', error);
      throw error;
    }
  });

  ipcMain.handle('plugins.setEnabled', async (_event, pluginId: string, enabled: boolean) => {
    try {
      const pluginRuntimeService = getPluginRuntimeService();
      if (!pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      const result = await pluginRuntimeService.setEnabled(pluginId, enabled);
      getSessionManager()?.invalidateSkillsSetup();
      return result;
    } catch (error) {
      logError('[Plugins] Error toggling plugin:', error);
      throw error;
    }
  });

  ipcMain.handle(
    'plugins.setComponentEnabled',
    async (
      _event,
      pluginId: string,
      component: 'skills' | 'commands' | 'agents' | 'hooks' | 'mcp',
      enabled: boolean
    ) => {
      try {
        const pluginRuntimeService = getPluginRuntimeService();
        if (!pluginRuntimeService) {
          throw new Error('PluginRuntimeService not initialized');
        }
        const result = await pluginRuntimeService.setComponentEnabled(pluginId, component, enabled);
        if (component === 'skills') {
          getSessionManager()?.invalidateSkillsSetup();
        }
        return result;
      } catch (error) {
        logError('[Plugins] Error toggling plugin component:', error);
        throw error;
      }
    }
  );

  ipcMain.handle('plugins.uninstall', async (_event, pluginId: string) => {
    try {
      const pluginRuntimeService = getPluginRuntimeService();
      if (!pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      const result = await pluginRuntimeService.uninstall(pluginId);
      getSessionManager()?.invalidateSkillsSetup();
      return result;
    } catch (error) {
      logError('[Plugins] Error uninstalling plugin:', error);
      throw error;
    }
  });
}
