/**
 * IPC surface for the media generation service. Side-effect free: the integrator
 * calls `registerMediaGenIpc` from the main entry after creating the service.
 */
import type { IpcMain } from 'electron';
import type { MediaGenRequest, MediaGenService } from './media-gen-service.js';

export const MEDIA_GEN_CHANNELS = {
  generateImage: 'media.generateImage',
} as const;

export function registerMediaGenIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  service: MediaGenService,
): void {
  ipcMain.handle(MEDIA_GEN_CHANNELS.generateImage, async (_event, req: MediaGenRequest) =>
    service.generateImage(req ?? { prompt: '' }),
  );
}
