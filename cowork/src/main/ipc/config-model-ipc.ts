import { ipcMain, shell } from 'electron';
import { configStore } from '../config/config-store';
import { log, logError } from '../utils/logger';
import {
  getGeminiOauthTokens,
  clearGeminiCredentials,
} from '../../../../src/providers/gemini-oauth';
import {
  loginInteractive as codexLoginInteractive,
  clearCodexCredentials,
  getChatGptAuth,
  hasCodexCredentials,
} from '../../../../src/providers/codex-oauth';

export function registerConfigModelIpcHandlers() {
  // ── Model switch IPC handler ──────────────────────────────────────────
  ipcMain.handle('config.switchModel', async (_event, model: string) => {
    try {
      configStore.update({ model });
      log('[IPC] Model switched to:', model);
      return true;
    } catch {
      return false;
    }
  });

  // ── Gemini OAuth IPC handlers ─────────────────────────────────────────
  ipcMain.handle('config.geminiOauthLogin', async () => {
    try {
      const tokens = await getGeminiOauthTokens(true);
      return { success: true, tokens };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('[IPC] Gemini OAuth Login failed:', err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('config.geminiOauthClear', async () => {
    try {
      await clearGeminiCredentials();
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('[IPC] Gemini OAuth Clear failed:', err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('config.codexOauthLogin', async () => {
    try {
      const auth = await codexLoginInteractive((url) => { shell.openExternal(url); });
      return {
        success: true,
        email: auth.email ?? null,
        plan_type: auth.plan_type ?? null,
        account_id: auth.account_id ?? null,
        is_fedramp: auth.is_fedramp,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('[IPC] Codex OAuth Login failed:', err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('config.codexOauthClear', async () => {
    try {
      clearCodexCredentials();
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('[IPC] Codex OAuth Clear failed:', err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('config.codexOauthStatus', async () => {
    try {
      if (!hasCodexCredentials()) {
        return { success: true, signedIn: false };
      }
      const auth = await getChatGptAuth();
      if (!auth) {
        return { success: true, signedIn: false, error: 'credentials present but unreadable' };
      }
      return {
        success: true,
        signedIn: true,
        email: auth.email ?? null,
        plan_type: auth.plan_type ?? null,
        account_id: auth.account_id ?? null,
        is_fedramp: auth.is_fedramp,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('[IPC] Codex OAuth Status failed:', err);
      return { success: false, error: message };
    }
  });
}
