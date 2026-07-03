/**
 * `sessionInsights.*` IPC — the past-session insights surface: list/search/
 * detail, a recall-prefill (relevant prior context for a new prompt), plus
 * per-session audit + repair. Thin layer over {@link SessionInsightsBridge}.
 *
 * Extracted from the main index.ts god-file. `sessionInsightsBridge` is a
 * runtime mutable (built when the DB opens), so it is injected as an ACCESSOR
 * (getter) — the handlers read the current instance via optional chaining and
 * no-op with a safe default while it is still null. Bodies copied verbatim.
 *
 * @module main/ipc/session-insights-ipc
 */

import { ipcMain } from 'electron';
import type { SessionInsightsBridge } from '../session/session-insights-bridge';
import { logError } from '../utils/logger';

export interface SessionInsightsIpcDeps {
  /** Current SessionInsightsBridge (null until the DB is open) — accessor. */
  getSessionInsightsBridge: () => SessionInsightsBridge | null;
}

export function registerSessionInsightsIpcHandlers(deps: SessionInsightsIpcDeps): void {
  const { getSessionInsightsBridge } = deps;

  ipcMain.handle('sessionInsights.list', async (_event, limit?: number) => {
    try {
      return getSessionInsightsBridge()?.list(limit ?? 100) ?? [];
    } catch (err) {
      logError('[sessionInsights.list] failed:', err);
      return [];
    }
  });

  ipcMain.handle('sessionInsights.search', async (_event, query: string, limit?: number) => {
    try {
      return getSessionInsightsBridge()?.search(query ?? '', limit ?? 50) ?? [];
    } catch (err) {
      logError('[sessionInsights.search] failed:', err);
      return [];
    }
  });

  ipcMain.handle('sessionInsights.detail', async (_event, sessionId: string) => {
    try {
      return getSessionInsightsBridge()?.getDetail(sessionId) ?? null;
    } catch (err) {
      logError('[sessionInsights.detail] failed:', err);
      return null;
    }
  });

  ipcMain.handle(
    'sessionInsights.recallPrefill',
    async (
      _event,
      prompt: string,
      options?: {
        currentSessionId?: string;
        cwd?: string;
        limit?: number;
        maxChars?: number;
        perSessionMaxChars?: number;
      }
    ) => {
      try {
        return getSessionInsightsBridge()?.getRecallPrefill(prompt ?? '', options ?? {}) ?? null;
      } catch (err) {
        logError('[sessionInsights.recallPrefill] failed:', err);
        return null;
      }
    }
  );

  ipcMain.handle('sessionInsights.audit', async (_event, sessionId: string) => {
    try {
      return getSessionInsightsBridge()?.getAudit(sessionId) ?? null;
    } catch (err) {
      logError('[sessionInsights.audit] failed:', err);
      return null;
    }
  });

  ipcMain.handle('sessionInsights.repair', async (_event, sessionId: string) => {
    try {
      return getSessionInsightsBridge()?.repair(sessionId) ?? null;
    } catch (err) {
      logError('[sessionInsights.repair] failed:', err);
      return null;
    }
  });
}
