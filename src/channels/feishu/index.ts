/**
 * Feishu (Lark) Channel Adapter
 *
 * Connects to Feishu/Lark API for messaging within the Feishu ecosystem.
 * Supports text, rich text, interactive cards, file uploads,
 * interactive approval cards, and reasoning stream hooks.
 *
 * Native Engine v2026.3.11 alignment: approval cards, reasoning streams,
 * identity-aware headers, full thread context.
 */

import { logger } from '../../utils/logger.js';
import { BaseChannel, ChannelConfig, DeliveryResult, OutboundMessage } from '../core.js';

// ============================================================================
// Types
// ============================================================================

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  port?: number;
  /** Agent name for card headers (identity-aware) */
  agentName?: string;
  /** Agent avatar image key */
  agentAvatar?: string;
}

/**
 * Action button for interactive approval/launcher cards.
 */
export interface FeishuCardAction {
  /** Button label */
  label: string;
  /** Action identifier (sent back in card callback) */
  actionId: string;
  /** Button style: primary, danger, or default */
  style?: 'primary' | 'danger' | 'default';
}

/**
 * Reasoning stream handler — called during LLM reasoning.
 */
export type ReasoningStreamHandler = (chunk: string) => void;

/**
 * Reasoning end handler — called when reasoning completes.
 */
export type ReasoningEndHandler = (fullReasoning: string) => void;

export interface FeishuChannelConfig extends ChannelConfig {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  port?: number;
}

export interface FeishuMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  content: string;
  messageType: 'text' | 'post' | 'image' | 'interactive' | 'file';
  createTime: string;
}

/**
 * Legacy in-process adapter.
 *
 * The real outbound transport now lives in {@link FeishuChannel}, which mints a
 * genuine `tenant_access_token` and POSTs through the REST `im/v1/messages`
 * API. This class is retained for its still-useful, network-free helpers — the
 * interactive-card builders, reasoning-stream hooks, and `getThreadMessages`
 * (exercised by `tests/channels/feishu-cards.test.ts`). Its `sendText` /
 * `sendCard` / `sendImage` / `replyMessage` methods, however, perform NO
 * network I/O and return synthetic ids; they are kept only for backward-compat
 * and are not on the real send path. Prefer {@link FeishuChannel.send}.
 */
export class FeishuAdapter {
  private config: FeishuConfig;
  private running = false;
  private accessToken: string | null = null;

  constructor(config: FeishuConfig) {
    this.config = {
      port: 9000,
      ...config,
    };
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('FeishuAdapter is already running');
    }
    logger.debug('FeishuAdapter: starting', { appId: this.config.appId });
    this.accessToken = `tenant_access_token_${this.config.appId}`;
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    logger.debug('FeishuAdapter: stopping');
    this.accessToken = null;
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** @deprecated No network I/O — returns a synthetic id. Use {@link FeishuChannel.send}. */
  async sendText(chatId: string, text: string): Promise<{ success: boolean; messageId: string }> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    const messageId = `msg_${Date.now()}`;
    logger.debug('FeishuAdapter: send text', { chatId, textLength: text.length });
    return { success: true, messageId };
  }

  /** @deprecated No network I/O — returns a synthetic id. Use {@link FeishuChannel.send}. */
  async sendCard(chatId: string, card: Record<string, unknown>): Promise<{ success: boolean; messageId: string }> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    const messageId = `msg_${Date.now()}`;
    logger.debug('FeishuAdapter: send card', { chatId });
    return { success: true, messageId };
  }

  /** @deprecated No network I/O — returns a synthetic id. Use {@link FeishuChannel.send}. */
  async sendImage(chatId: string, imageKey: string): Promise<{ success: boolean; messageId: string }> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    const messageId = `msg_${Date.now()}`;
    logger.debug('FeishuAdapter: send image', { chatId, imageKey });
    return { success: true, messageId };
  }

  /** @deprecated No network I/O. Use {@link FeishuChannel.send} with `replyTo` instead. */
  async replyMessage(messageId: string, text: string): Promise<{ success: boolean }> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    logger.debug('FeishuAdapter: reply', { messageId, textLength: text.length });
    return { success: true };
  }

  async getChatMembers(chatId: string): Promise<Array<{ userId: string; name: string }>> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    logger.debug('FeishuAdapter: get chat members', { chatId });
    return [];
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  // ============================================================================
  // Interactive Cards (Native Engine v2026.3.11)
  // ============================================================================

  /**
   * Build an interactive approval card with approve/reject actions.
   */
  buildApprovalCard(
    title: string,
    description: string,
    actions: FeishuCardAction[],
  ): Record<string, unknown> {
    const header: Record<string, unknown> = {
      title: { tag: 'plain_text', content: title },
      template: 'blue',
    };
    // Identity-aware: inject agent name/avatar if configured
    if (this.config.agentName) {
      header.subtitle = { tag: 'plain_text', content: this.config.agentName };
    }

    return {
      config: { wide_screen_mode: true },
      header,
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: description } },
        { tag: 'hr' },
        {
          tag: 'action',
          actions: actions.map(a => ({
            tag: 'button',
            text: { tag: 'plain_text', content: a.label },
            type: a.style ?? 'default',
            value: { action_id: a.actionId },
          })),
        },
      ],
    };
  }

  /**
   * Build an action launcher card with multiple buttons.
   */
  buildActionLauncherCard(
    title: string,
    buttons: FeishuCardAction[],
  ): Record<string, unknown> {
    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: title },
        template: 'green',
      },
      elements: [
        {
          tag: 'action',
          actions: buttons.map(b => ({
            tag: 'button',
            text: { tag: 'plain_text', content: b.label },
            type: b.style ?? 'default',
            value: { action_id: b.actionId },
          })),
        },
      ],
    };
  }

  // ============================================================================
  // Reasoning Streams (Native Engine v2026.3.11)
  // ============================================================================

  private reasoningStreamHandlers: ReasoningStreamHandler[] = [];
  private reasoningEndHandlers: ReasoningEndHandler[] = [];

  /**
   * Register a handler for reasoning stream chunks.
   */
  onReasoningStream(handler: ReasoningStreamHandler): void {
    this.reasoningStreamHandlers.push(handler);
  }

  /**
   * Register a handler for reasoning completion.
   */
  onReasoningEnd(handler: ReasoningEndHandler): void {
    this.reasoningEndHandlers.push(handler);
  }

  /**
   * Emit a reasoning stream chunk to all registered handlers.
   */
  emitReasoningStream(chunk: string): void {
    for (const handler of this.reasoningStreamHandlers) {
      try {
        handler(chunk);
      } catch (err) {
        logger.debug(`Feishu reasoning stream handler error: ${err}`);
      }
    }
  }

  /**
   * Emit reasoning end to all registered handlers.
   */
  emitReasoningEnd(fullReasoning: string): void {
    for (const handler of this.reasoningEndHandlers) {
      try {
        handler(fullReasoning);
      } catch (err) {
        logger.debug(`Feishu reasoning end handler error: ${err}`);
      }
    }
  }

  // ============================================================================
  // Thread Context (Native Engine v2026.3.11)
  // ============================================================================

  /**
   * Fetch full thread messages including bot replies.
   */
  async getThreadMessages(chatId: string): Promise<FeishuMessage[]> {
    if (!this.running) {
      throw new Error('FeishuAdapter is not running');
    }
    logger.debug('FeishuAdapter: get thread messages', { chatId });
    // Returns empty — real implementation would call Feishu API
    return [];
  }
}

// ============================================================================
// Real-transport status
// ============================================================================

const DEFAULT_FEISHU_BASE_URL = 'https://open.feishu.cn';

/**
 * Structured result of attempting to bring up the inbound receive channel.
 *
 * Feishu/Lark's real-time push is delivered over a proprietary persistent
 * "long-connection" (WebSocket) whose wire framing is NOT publicly specified:
 * frames are Protobuf (`pbbp2` Frame messages with a CONTROL/DATA `method`
 * discriminator, internal header keys, and gzip-compressed, chunk-reassembled
 * JSON payloads that each require a server ACK frame). That schema, the control
 * opcodes, and the ACK handshake ship only inside the official Lark SDK
 * (`@larksuiteoapi/node-sdk`). We deliberately do NOT reimplement it from a
 * guess: a hand-rolled framing would not be the real protocol, and any "mock"
 * exercising it would only validate our own invention rather than the wire
 * contract. The outbound REST path, by contrast, IS fully implemented below.
 */
export interface FeishuReceiveStatus {
  /** Always false — no genuine inbound socket is opened. */
  connected: false;
  /** Machine-readable reason code. */
  reason: 'lark-sdk-required';
  /** Human-readable explanation. */
  detail: string;
}

export class FeishuChannel extends BaseChannel {
  private adapter: FeishuAdapter | null = null;
  private readonly baseUrl: string;
  /** Cached tenant_access_token (re-minted on demand if the API rejects it). */
  private tenantToken: string | null = null;
  private receiveStatus: FeishuReceiveStatus | null = null;

  constructor(config: FeishuChannelConfig) {
    super('feishu', config);
    const rawBase =
      (config.options?.['baseUrl'] as string | undefined) ??
      process.env.FEISHU_BASE_URL ??
      process.env.LARK_BASE_URL ??
      DEFAULT_FEISHU_BASE_URL;
    this.baseUrl = rawBase.trim().replace(/\/+$/, '');
  }

  /**
   * Bring the channel up.
   *
   * Outbound (`send()`) is fully functional: it lazily mints a
   * `tenant_access_token` and POSTs to `/open-apis/im/v1/messages`.
   *
   * Inbound (receiving user messages) requires Feishu's proprietary
   * long-connection — see {@link FeishuReceiveStatus}. We do NOT fake it, so
   * `connect()` records an honest "send-only" state: it provisions the legacy
   * adapter surface (card builders / reasoning hooks) and sets
   * `status.connected = false` for the receive side, surfacing the reason in
   * `status.error` / `status.info`. There is no live socket and therefore no
   * drop to recover from, so the shared ReconnectionManager is intentionally
   * not wired here.
   */
  async connect(): Promise<void> {
    const cfg = this.config as FeishuChannelConfig;
    this.adapter = new FeishuAdapter({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      verificationToken: cfg.verificationToken,
      encryptKey: cfg.encryptKey,
      port: cfg.port,
    });
    await this.adapter.start();

    this.receiveStatus = {
      connected: false,
      reason: 'lark-sdk-required',
      detail:
        'Feishu inbound long-connection (real-time receive) is not implemented: ' +
        "its Protobuf 'pbbp2' framing ships only inside the official Lark SDK and " +
        'cannot be reproduced faithfully without it. Outbound send() is fully ' +
        'functional via the REST im/v1/messages API.',
    };

    // Honest status: outbound is ready, but we have NOT established a live
    // inbound socket, so we must not claim the receive channel is connected.
    this.status.connected = false;
    this.status.authenticated = false;
    this.status.error = this.receiveStatus.detail;
    this.status.info = {
      outbound: 'ready',
      inbound: this.receiveStatus.reason,
    };
  }

  async disconnect(): Promise<void> {
    if (this.adapter) {
      await this.adapter.stop();
      this.adapter = null;
    }
    this.tenantToken = null;
    this.receiveStatus = null;
    this.status.connected = false;
    this.status.authenticated = false;
    delete this.status.error;
    this.emit('disconnected', this.type);
  }

  /**
   * Send an outbound message through the real Feishu REST API.
   *
   * Cards are sent with `msg_type: 'interactive'`; everything else as
   * `msg_type: 'text'`. The chat id (`message.channelId`) becomes the
   * `receive_id` with `receive_id_type=chat_id`.
   */
  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.adapter) {
      return { success: false, error: 'Not connected', timestamp: new Date() };
    }
    const chatId = message.channelId || '';
    if (!chatId) {
      return { success: false, error: 'Missing channelId (Feishu chat_id)', timestamp: new Date() };
    }

    const feishuData = (
      message as { channelData?: { feishu?: { card?: Record<string, unknown> } } }
    ).channelData?.feishu;

    let msgType: 'text' | 'interactive';
    let content: string;
    if (feishuData?.card) {
      msgType = 'interactive';
      content = JSON.stringify(feishuData.card);
    } else {
      msgType = 'text';
      content = JSON.stringify({ text: message.content });
    }

    try {
      return await this.postMessage(chatId, msgType, content);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      };
    }
  }

  /**
   * Honest, structured account of the inbound receive channel. Returns `null`
   * before `connect()` has run; otherwise a {@link FeishuReceiveStatus}
   * explaining why no live socket exists.
   */
  getReceiveStatus(): FeishuReceiveStatus | null {
    return this.receiveStatus;
  }

  /**
   * Get the underlying adapter (for direct card/reasoning API access).
   */
  getAdapter(): FeishuAdapter | null {
    return this.adapter;
  }

  // ==========================================================================
  // REST outbound (real)
  // ==========================================================================

  /**
   * POST a message to `/open-apis/im/v1/messages`, minting (and caching) a
   * tenant_access_token first. On an auth-class failure the token is dropped
   * and the call retried once with a fresh token.
   */
  private async postMessage(
    chatId: string,
    msgType: 'text' | 'interactive',
    content: string,
    retried = false,
  ): Promise<DeliveryResult> {
    const token = await this.ensureTenantToken();
    const url = `${this.baseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ receive_id: chatId, msg_type: msgType, content }),
    });

    const text = await response.text().catch(() => '');
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }

    const code = typeof parsed.code === 'number' ? parsed.code : undefined;

    // Feishu signals an expired/invalid tenant token with a non-zero `code`
    // (99991663/99991664/...) and HTTP 200. Drop the cached token and retry once.
    if (!retried && (code === 99991663 || code === 99991664 || response.status === 401)) {
      this.tenantToken = null;
      return this.postMessage(chatId, msgType, content, true);
    }

    if (!response.ok || (code !== undefined && code !== 0)) {
      const msg = typeof parsed.msg === 'string' ? parsed.msg : text.slice(0, 300);
      return {
        success: false,
        error: `Feishu send failed: status=${response.status} code=${code ?? 'n/a'} msg=${msg}`,
        timestamp: new Date(),
      };
    }

    const data = (parsed.data ?? {}) as Record<string, unknown>;
    const messageId = typeof data.message_id === 'string' ? data.message_id : undefined;
    this.status.lastActivity = new Date();
    const result: DeliveryResult = { success: true, timestamp: new Date() };
    if (messageId) result.messageId = messageId;
    return result;
  }

  /**
   * Return a cached tenant_access_token, minting one via
   * `/open-apis/auth/v3/tenant_access_token/internal` if needed. This is the
   * same internal-app credential exchange used by `src/tools/feishu-tool.ts`.
   */
  private async ensureTenantToken(): Promise<string> {
    if (this.tenantToken) return this.tenantToken;

    const cfg = this.config as FeishuChannelConfig;
    if (!cfg.appId || !cfg.appSecret) {
      throw new Error('Feishu appId/appSecret are required to mint a tenant_access_token');
    }

    const response = await fetch(
      `${this.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret }),
      },
    );

    const text = await response.text().catch(() => '');
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }

    const code = typeof parsed.code === 'number' ? parsed.code : undefined;
    if (!response.ok || (code !== undefined && code !== 0)) {
      const msg = typeof parsed.msg === 'string' ? parsed.msg : text.slice(0, 300);
      throw new Error(
        `Feishu tenant_access_token request failed: status=${response.status} code=${code ?? 'n/a'} msg=${msg}`,
      );
    }

    const token = typeof parsed.tenant_access_token === 'string' ? parsed.tenant_access_token : '';
    if (!token) {
      throw new Error('Feishu tenant_access_token response missing tenant_access_token');
    }
    this.tenantToken = token;
    this.status.authenticated = true;
    return token;
  }
}
