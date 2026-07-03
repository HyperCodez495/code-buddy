/**
 * `mcp.*` IPC — MCP server config CRUD (getServers/getServer/saveServer/
 * deleteServer/clearOAuthTokens/getTools/getServerStatus/getPresets) and the
 * MCP marketplace bridge (registry/registrySearch/…/invokeTool).
 *
 * Extracted from the main index.ts god-file. Unlike workflow-service-ipc,
 * this group reads TWO runtime-reassigned module mutables — `sessionManager`
 * (rebuilt when the DB opens) and `mcpMarketplaceBridge` (created after boot)
 * — so they are injected as ACCESSORS (getters), not values, so the handlers
 * always read the current instance. The `mcpConfigStore` singleton is an
 * importable module const and needs no injection.
 *
 * @module main/ipc/mcp-ipc
 */

import { ipcMain } from 'electron';
import { mcpConfigStore } from '../mcp/mcp-config-store';
import type { SessionManager } from '../session/session-manager';
import type { MCPMarketplaceBridge } from '../mcp/mcp-marketplace-bridge';
import type { MCPServerConfig } from '../mcp/mcp-manager';
import { log, logError } from '../utils/logger';

export interface McpIpcDeps {
  /** Current SessionManager (null until the DB is open) — accessor, not value. */
  getSessionManager: () => SessionManager | null;
  /** Current MCP marketplace bridge (null until created at boot) — accessor. */
  getMarketplaceBridge: () => MCPMarketplaceBridge | null;
}

export function registerMcpIpcHandlers(deps: McpIpcDeps): void {
  const { getSessionManager, getMarketplaceBridge } = deps;

  // ── MCP server config CRUD ───────────────────────────────────────
  ipcMain.handle('mcp.getServers', () => {
    try {
      return mcpConfigStore.getServers();
    } catch (error) {
      logError('[MCP] Error getting servers:', error);
      return [];
    }
  });

  ipcMain.handle('mcp.getServer', (_event, serverId: string) => {
    try {
      return mcpConfigStore.getServer(serverId);
    } catch (error) {
      logError('[MCP] Error getting server:', error);
      return null;
    }
  });

  ipcMain.handle('mcp.saveServer', async (_event, config: MCPServerConfig) => {
    mcpConfigStore.saveServer(config);
    // Update only this specific server, not all servers
    const sessionManager = getSessionManager();
    if (sessionManager) {
      const mcpManager = sessionManager.getMCPManager();
      try {
        await mcpManager.updateServer(config);
        sessionManager.invalidateMcpServersCache();
        log(`[MCP] Server ${config.name} updated successfully`);
      } catch (err) {
        logError('[MCP] Failed to update server:', err);
        // Roll back: save the config with enabled=false so a broken connector
        // is not retried on next app startup
        if (config.enabled) {
          mcpConfigStore.saveServer({ ...config, enabled: false });
        }
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMessage };
      }
    }
    return { success: true };
  });

  ipcMain.handle('mcp.deleteServer', async (_event, serverId: string) => {
    mcpConfigStore.deleteServer(serverId);
    // Remove and disconnect only this specific server
    const sessionManager = getSessionManager();
    if (sessionManager) {
      const mcpManager = sessionManager.getMCPManager();
      try {
        await mcpManager.removeServer(serverId);
        sessionManager.invalidateMcpServersCache();
        log(`[MCP] Server ${serverId} removed successfully`);
      } catch (err) {
        logError('[MCP] Failed to remove server:', err);
      }
    }
    return { success: true };
  });

  ipcMain.handle('mcp.clearOAuthTokens', async (_event, serverId: string) => {
    try {
      const sessionManager = getSessionManager();
      if (sessionManager) {
        const mcpManager = sessionManager.getMCPManager();
        await mcpManager.clearOAuthTokens(serverId);
        // Drop the live connection so the next connect re-triggers authorization.
        await mcpManager.removeServer(serverId).catch(() => {});
        sessionManager.invalidateMcpServersCache();
      }
      return { success: true };
    } catch (error) {
      logError('[MCP] Failed to clear OAuth tokens:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('mcp.getTools', () => {
    try {
      const sessionManager = getSessionManager();
      if (!sessionManager) {
        return [];
      }
      const mcpManager = sessionManager.getMCPManager();
      return mcpManager.getTools();
    } catch (error) {
      logError('[MCP] Error getting tools:', error);
      return [];
    }
  });

  ipcMain.handle('mcp.getServerStatus', () => {
    try {
      const sessionManager = getSessionManager();
      if (!sessionManager) {
        return [];
      }
      const mcpManager = sessionManager.getMCPManager();
      return mcpManager.getServerStatus();
    } catch (error) {
      logError('[MCP] Error getting server status:', error);
      return [];
    }
  });

  ipcMain.handle('mcp.getPresets', () => {
    try {
      return mcpConfigStore.getPresets();
    } catch (error) {
      logError('[MCP] Error getting presets:', error);
      return {};
    }
  });

  // ── MCP marketplace (Claude Cowork parity Phase 2) ───────────────
  ipcMain.handle('mcp.registry', () => {
    const bridge = getMarketplaceBridge();
    if (!bridge) return [];
    return bridge.list();
  });

  ipcMain.handle('mcp.registrySearch', (_event, query: string) => {
    const bridge = getMarketplaceBridge();
    if (!bridge) return [];
    return bridge.search(query);
  });

  ipcMain.handle('mcp.registryGet', (_event, id: string) => {
    const bridge = getMarketplaceBridge();
    if (!bridge) return null;
    return bridge.get(id);
  });

  ipcMain.handle(
    'mcp.registryInstall',
    async (_event, id: string, envOverrides?: Record<string, string>) => {
      const bridge = getMarketplaceBridge();
      if (!bridge) {
        return { success: false, error: 'Marketplace bridge unavailable' };
      }
      return bridge.install(id, envOverrides);
    }
  );

  ipcMain.handle('mcp.registryUninstall', async (_event, id: string) => {
    const bridge = getMarketplaceBridge();
    if (!bridge) {
      return { success: false, error: 'Marketplace bridge unavailable' };
    }
    return bridge.uninstall(id);
  });

  ipcMain.handle('mcp.registrySetEnabled', async (_event, id: string, enabled: boolean) => {
    const bridge = getMarketplaceBridge();
    if (!bridge) {
      return { success: false, error: 'Marketplace bridge unavailable' };
    }
    return bridge.setEnabled(id, enabled);
  });

  ipcMain.handle('mcp.registryTools', (_event, id: string) => {
    const bridge = getMarketplaceBridge();
    if (!bridge) return [];
    return bridge.getTools(id);
  });

  // Phase 3 step 7: MCP tool playground
  ipcMain.handle('mcp.listAllTools', () => {
    try {
      const bridge = getMarketplaceBridge();
      if (!bridge) return [];
      return bridge.listAllTools();
    } catch (err) {
      logError('[mcp.listAllTools] failed:', err);
      return [];
    }
  });

  ipcMain.handle(
    'mcp.invokeTool',
    async (_event, toolName: string, args: Record<string, unknown>) => {
      try {
        const bridge = getMarketplaceBridge();
        if (!bridge) {
          return {
            success: false,
            durationMs: 0,
            error: 'MCP marketplace bridge not ready',
          };
        }
        return await bridge.invokeTool(toolName, args ?? {});
      } catch (err) {
        logError('[mcp.invokeTool] failed:', err);
        return {
          success: false,
          durationMs: 0,
          error: (err as Error).message,
        };
      }
    }
  );
}
