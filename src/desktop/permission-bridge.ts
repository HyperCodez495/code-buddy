/**
 * Permission Bridge
 *
 * Bridges Code Buddy's ConfirmationService to the Electron IPC
 * permission dialog. When the engine requests user approval for
 * a destructive operation, this bridge sends an IPC event to the
 * renderer and waits for the user's response.
 *
 * @module desktop/permission-bridge
 */

import { logger } from '../utils/logger.js';
import type {
  EnginePermissionRequest,
  EnginePermissionResponse,
} from '../shared/engine-types.js';

/** Response enriched with the user's optional denial reason (Hermes parity:
 * the reason travels back to the agent as confirmation feedback). */
export interface DetailedPermissionResponse {
  response: EnginePermissionResponse;
  reason?: string;
}

/** Pending permission request with resolve callback */
interface PendingRequest {
  request: EnginePermissionRequest;
  resolve: (response: DetailedPermissionResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Callback type for sending IPC events to the Electron renderer.
 * Injected at construction time to avoid importing Electron directly.
 */
export type SendToRendererFn = (event: {
  type: string;
  payload: unknown;
}) => void;

/**
 * Bridges engine permission requests to Electron IPC.
 *
 * Usage:
 * ```ts
 * const bridge = new DesktopPermissionBridge(sendToRenderer);
 * engineAdapter.setPermissionCallback(bridge.requestPermission.bind(bridge));
 *
 * // In IPC handler:
 * ipcMain.on('permission.response', (_, { id, response }) => {
 *   bridge.handleResponse(id, response);
 * });
 * ```
 */
export class DesktopPermissionBridge {
  private pending: Map<string, PendingRequest> = new Map();
  private sendToRenderer: SendToRendererFn;
  private timeoutMs: number;

  /** Tools that never require permission */
  private static readonly SAFE_TOOLS = new Set([
    'read_file', 'view_file', 'grep', 'glob', 'list_files',
    'search', 'plan', 'reason', 'think', 'tree',
  ]);

  constructor(sendToRenderer: SendToRendererFn, timeoutMs = 90_000) {
    this.sendToRenderer = sendToRenderer;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Request permission from the user via IPC.
   * Returns a promise that resolves when the user responds.
   */
  async requestPermission(
    request: EnginePermissionRequest
  ): Promise<EnginePermissionResponse> {
    return (await this.requestPermissionDetailed(request)).response;
  }

  /**
   * Same as {@link requestPermission} but keeps the user's optional denial
   * reason so callers can surface it to the agent.
   */
  async requestPermissionDetailed(
    request: EnginePermissionRequest
  ): Promise<DetailedPermissionResponse> {
    // Auto-allow safe tools
    if (DesktopPermissionBridge.SAFE_TOOLS.has(request.operation)) {
      return { response: 'allow' };
    }

    return new Promise<DetailedPermissionResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        logger.warn('[PermissionBridge] timed out', { id: request.id });
        resolve({ response: 'deny', reason: 'Demande expirée sans réponse' });
      }, this.timeoutMs);

      this.pending.set(request.id, { request, resolve, timer });

      // Send to renderer in the shape its `PermissionDialog` expects
      // (see `cowork/src/renderer/types/index.ts:PermissionRequest`).
      // The `bridgeId` field signals the renderer to route the
      // response via `permission.bridge.response` instead of the
      // pi-runner channel `permission.response` — both runners share
      // the `permission.request` ServerEvent name but speak to
      // different reply channels.
      const inputPayload: Record<string, unknown> = {};
      if (request.filename !== undefined) inputPayload.filename = request.filename;
      if (request.content !== undefined) inputPayload.content = request.content;
      if (request.diffPreview !== undefined) inputPayload.diffPreview = request.diffPreview;

      this.sendToRenderer({
        type: 'permission.request',
        payload: {
          toolUseId: request.id,
          toolName: request.operation,
          input: inputPayload,
          sessionId: 'engine',
          bridgeId: request.id,
        },
      });

      logger.debug('[PermissionBridge] sent request', {
        id: request.id,
        operation: request.operation,
      });
    });
  }

  /**
   * Handle user's response from the renderer via IPC.
   */
  handleResponse(id: string, response: EnginePermissionResponse, reason?: string): void {
    const pending = this.pending.get(id);
    if (!pending) {
      logger.warn('[PermissionBridge] unknown request id', { id });
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(reason !== undefined ? { response, reason } : { response });
    logger.debug('[PermissionBridge] resolved', { id, response });
  }

  /**
   * Cancel all pending requests (e.g., on session stop).
   */
  cancelAll(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ response: 'deny', reason: 'Session arrêtée' });
      logger.debug('[PermissionBridge] cancelled', { id });
    }
    this.pending.clear();
  }

  /**
   * Number of pending permission requests.
   */
  get pendingCount(): number {
    return this.pending.size;
  }
}
