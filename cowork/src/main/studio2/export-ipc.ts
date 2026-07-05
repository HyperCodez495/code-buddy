import type { IpcMain } from 'electron';
import { ExportService, type ExportProjectRequest, type ImportFolderRequest } from './export-service.js';
export const STUDIO2_EXPORT_CHANNELS = { exportProject: 'studio2.export.project', importFolder: 'studio2.import.folder' } as const;
export function registerExportIpc(ipcMain: Pick<IpcMain, 'handle'>, service = new ExportService()): void {
  ipcMain.handle(STUDIO2_EXPORT_CHANNELS.exportProject, (_event, request: ExportProjectRequest) => service.exportProject(request));
  ipcMain.handle(STUDIO2_EXPORT_CHANNELS.importFolder, (_event, request: ImportFolderRequest) => service.importFolder(request));
}
