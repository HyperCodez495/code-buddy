/**
 * `workflow.*` IPC — lifecycle of the self-hosted WorkflowBuilder Pro dev
 * server (start/stop/status) plus its buffered boot log (logs). Thin layer
 * over {@link WorkflowService}; the panel polls `workflow.logs` to stream
 * boot progress.
 *
 * Extracted from the main index.ts god-file (first self-contained slice —
 * this group only depends on WorkflowService, no sessionManager coupling).
 *
 * @module main/ipc/workflow-service-ipc
 */

import { ipcMain } from 'electron';
import { WorkflowService } from '../workflow-service';

export function registerWorkflowServiceIpcHandlers(): void {
  ipcMain.handle('workflow.start', async () => await WorkflowService.start());
  ipcMain.handle('workflow.stop', async () => await WorkflowService.stop());
  ipcMain.handle('workflow.status', () => WorkflowService.status());
  ipcMain.handle('workflow.logs', (_event, limit?: number) => WorkflowService.logs(limit));
}
