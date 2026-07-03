/**
 * `cost.*` IPC — the cost dashboard (Claude Cowork parity Phase 2):
 * session/daily/weekly/monthly rollups (summary), the daily history and
 * per-model breakdown series, budget + daily-limit setters, and a manual
 * usage record. Thin layer over {@link CostBridge}.
 *
 * Extracted from the main index.ts god-file. `costBridge` is a runtime
 * mutable (built when the DB opens), so it is injected as an ACCESSOR
 * (getter) — the handlers always read the current instance and no-op with a
 * safe default while it is still null.
 *
 * @module main/ipc/cost-ipc
 */

import { ipcMain } from 'electron';
import type { CostBridge } from '../cost/cost-bridge';

export interface CostIpcDeps {
  /** Current CostBridge (null until the DB is open) — accessor, not value. */
  getCostBridge: () => CostBridge | null;
}

export function registerCostIpcHandlers(deps: CostIpcDeps): void {
  const { getCostBridge } = deps;

  ipcMain.handle('cost.summary', async () => {
    const costBridge = getCostBridge();
    if (!costBridge) {
      return {
        sessionCost: 0,
        dailyCost: 0,
        weeklyCost: 0,
        monthlyCost: 0,
        totalCost: 0,
        sessionTokens: { input: 0, output: 0 },
        modelBreakdown: {},
      };
    }
    return costBridge.getSummary();
  });

  ipcMain.handle('cost.history', (_event, days?: number) => {
    const costBridge = getCostBridge();
    if (!costBridge) return [];
    return costBridge.getDailyHistory(days);
  });

  ipcMain.handle('cost.modelBreakdown', (_event, days?: number) => {
    const costBridge = getCostBridge();
    if (!costBridge) return [];
    return costBridge.getModelBreakdown(days);
  });

  ipcMain.handle('cost.setBudget', async (_event, monthlyLimit: number) => {
    const costBridge = getCostBridge();
    if (!costBridge) return { success: false };
    await costBridge.setBudget(monthlyLimit);
    return { success: true };
  });

  ipcMain.handle('cost.setDailyLimit', async (_event, limit: number) => {
    const costBridge = getCostBridge();
    if (!costBridge) return { success: false };
    await costBridge.setDailyLimit(limit);
    return { success: true };
  });

  ipcMain.handle(
    'cost.record',
    async (_event, inputTokens: number, outputTokens: number, model: string, cost?: number) => {
      const costBridge = getCostBridge();
      if (!costBridge) return { success: false };
      await costBridge.record(inputTokens, outputTokens, model, cost);
      return { success: true };
    }
  );
}
