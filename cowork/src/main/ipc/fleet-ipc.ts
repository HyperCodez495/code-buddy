import { ipcMain } from 'electron';
import type { FleetBridge } from '../fleet/fleet-bridge';

export function registerFleetIpcHandlers(fleetBridge: FleetBridge | null) {
  ipcMain.handle('fleet.list', async () => {
    if (!fleetBridge) return [];
    return fleetBridge.listPeers();
  });

  ipcMain.handle(
    'fleet.addPeer',
    async (
      _event,
      input: { url: string; apiKey?: string; jwt?: string; label?: string }
    ) => {
      if (!fleetBridge) return { success: false, error: 'FleetBridge not initialized' };
      return fleetBridge.addPeer(input);
    }
  );

  ipcMain.handle('fleet.removePeer', async (_event, peerId: string) => {
    if (!fleetBridge) return { success: false };
    return fleetBridge.removePeer(peerId);
  });

  ipcMain.handle('fleet.reconnect', async (_event, peerId: string) => {
    if (!fleetBridge) return { success: false, error: 'FleetBridge not initialized' };
    return fleetBridge.reconnectPeer(peerId);
  });

  ipcMain.handle(
    'fleet.events',
    async (_event, peerId?: string, limit?: number) => {
      if (!fleetBridge) return [];
      return fleetBridge.getRecentEvents(peerId, limit);
    }
  );
}
