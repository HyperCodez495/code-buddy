import type { IpcMain } from 'electron';
import { GitService } from './git-service.js';
export const STUDIO2_GIT_CHANNELS = { init: 'studio2.git.init', status: 'studio2.git.status', commit: 'studio2.git.commit', log: 'studio2.git.log' } as const;
export function registerGitIpc(ipcMain: Pick<IpcMain, 'handle'>, service = new GitService()): void {
  ipcMain.handle(STUDIO2_GIT_CHANNELS.init, (_event, projectRoot: string) => service.init(projectRoot));
  ipcMain.handle(STUDIO2_GIT_CHANNELS.status, (_event, projectRoot: string) => service.status(projectRoot));
  ipcMain.handle(STUDIO2_GIT_CHANNELS.commit, (_event, projectRoot: string, message: string) => service.commit(projectRoot, message));
  ipcMain.handle(STUDIO2_GIT_CHANNELS.log, (_event, projectRoot: string, limit?: number) => service.log(projectRoot, limit));
}
