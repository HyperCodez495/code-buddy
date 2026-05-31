/**
 * Channels IPC (read-only) — surfaces the core ChannelManager's per-channel
 * connection status to Cowork. Wraps `getChannelManager().getStatus()`
 * (`src/channels/core.ts`). Read-only: configuring / sending stays on the CLI
 * (`buddy` channel layer + cron delivery), and the free-form `info` blob (which
 * may carry tokens/ids) is dropped before crossing to the renderer.
 *
 * @module main/ipc/channels-ipc
 */

import { ipcMain } from 'electron';
import { logError } from '../utils/logger';
import {
  getChannelGatewayStatusForReview,
  type ChannelGatewayStatusPayload,
} from '../tools/channel-gateway-readiness-bridge';

export function registerChannelsIpcHandlers(): void {
  ipcMain.handle('channels.status', async () => {
    try {
      return await getChannelGatewayStatusForReview();
    } catch (err) {
      logError('[channels.status] failed:', err);
      return {
        error: err instanceof Error ? err.message : String(err),
        items: [],
        ok: false,
        report: null,
      } satisfies ChannelGatewayStatusPayload;
    }
  });
}
