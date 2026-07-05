import type { IpcMain } from 'electron';
import { DeployService, type DeployRequest } from './deploy-service.js';

export const STUDIO2_DEPLOY_CHANNELS = { deploy: 'studio2.deploy.run', detect: 'studio2.deploy.detect' } as const;
export function registerDeployIpc(ipcMain: Pick<IpcMain, 'handle'>, service = new DeployService()): void {
  ipcMain.handle(STUDIO2_DEPLOY_CHANNELS.deploy, (_event, request: DeployRequest) => service.deploy(request));
  ipcMain.handle(STUDIO2_DEPLOY_CHANNELS.detect, (_event, target: 'surge' | 'netlify' | 'vercel') => service.detectCli(target));
}
