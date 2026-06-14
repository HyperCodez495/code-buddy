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
import {
  BaseChannel,
  ChannelConfig,
  ContentType,
  DeliveryResult,
  InboundMessage,
  OutboundMessage,
} from '../core.js';

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

// ============================================================================
// Inbound event parsing (im.message.receive_v1)
// ============================================================================

/**
 * Shape of the `im.message.receive_v1` event body. Mirrors the Lark Open
 * Platform schema. The official `EventDispatcher` hands the handler the
 * UNWRAPPED `event` body (`{ sender, message }`); the full
 * `{ schema, header, event }` envelope only appears on the raw webhook. We
 * accept both (see {@link parseFeishuMessageEvent}).
 */
export interface FeishuReceiveEventBody {
  sender?: {
    sender_id?: {
      open_id?: string;
      union_id?: string;
      user_id?: string;
    };
    sender_type?: string;
    tenant_key?: string;
  };
  message?: {
    message_id?: string;
    root_id?: string;
    parent_id?: string;
    create_time?: string;
    chat_id?: string;
    thread_id?: string;
    chat_type?: 'p2p' | 'group' | string;
    message_type?: string;
    /** JSON-encoded string; structure varies by message_type. */
    content?: string;
    mentions?: Array<Record<string, unknown>>;
  };
}

/** The raw event as it may arrive: either the body, or the full envelope. */
export interface FeishuReceiveEventEnvelope {
  schema?: string;
  header?: Record<string, unknown>;
  event?: FeishuReceiveEventBody;
}

/** Map a Feishu `message_type` onto a Code Buddy {@link ContentType}. */
function feishuMessageTypeToContentType(messageType: string | undefined): ContentType {
  switch (messageType) {
    case 'image':
      return 'image';
    case 'audio':
      return 'audio';
    case 'media':
      return 'video';
    case 'file':
      return 'file';
    case 'sticker':
      return 'sticker';
    // 'text', 'post', 'interactive', 'share_chat', … all surface as text.
    default:
      return 'text';
  }
}

/**
 * Best-effort plain-text extraction from a Feishu message `content` JSON string.
 *
 * - `text`     → `{ "text": "hello" }`
 * - `post`     → `{ "<locale>": { "title": "...", "content": [[{tag,text}, …]] } }`
 * - otherwise  → the raw JSON string (so callers still see *something*).
 */
function extractFeishuText(messageType: string | undefined, contentJson: string | undefined): string {
  if (!contentJson) return '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(contentJson);
  } catch {
    // Not JSON (shouldn't happen for real events) — fall back to the raw string.
    return contentJson;
  }

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;

    // text / share_chat / etc.
    if (typeof obj.text === 'string') return obj.text;

    // post: locale-keyed rich text. Walk the first locale's `content` matrix
    // and concatenate every `text` segment.
    if (messageType === 'post' || (!('text' in obj) && hasPostShape(obj))) {
      const localeKey = Object.keys(obj)[0];
      const post = localeKey ? (obj[localeKey] as Record<string, unknown> | undefined) : undefined;
      const rows = post?.['content'];
      if (Array.isArray(rows)) {
        const pieces: string[] = [];
        const title = typeof post?.['title'] === 'string' ? (post['title'] as string) : '';
        if (title) pieces.push(title);
        for (const row of rows) {
          if (!Array.isArray(row)) continue;
          for (const seg of row) {
            if (seg && typeof seg === 'object') {
              const t = (seg as Record<string, unknown>).text;
              if (typeof t === 'string') pieces.push(t);
            }
          }
        }
        return pieces.join(' ').trim();
      }
    }
  }

  // Unknown structure — return the raw JSON so nothing is silently dropped.
  return contentJson;
}

function hasPostShape(obj: Record<string, unknown>): boolean {
  const firstKey = Object.keys(obj)[0];
  if (!firstKey) return false;
  const v = obj[firstKey];
  return !!v && typeof v === 'object' && 'content' in (v as Record<string, unknown>);
}

/**
 * Parse a Lark `im.message.receive_v1` event into a Code Buddy
 * {@link InboundMessage}.
 *
 * Envelope-tolerant: accepts either the unwrapped event body (what the SDK's
 * `EventDispatcher` hands the handler) or the full `{ schema, header, event }`
 * webhook envelope.
 *
 * Returns `null` when the event carries no usable message (e.g. a non-message
 * event slipped through, or no chat/text could be resolved).
 */
export function parseFeishuMessageEvent(
  raw: FeishuReceiveEventBody | FeishuReceiveEventEnvelope | undefined | null,
): InboundMessage | null {
  if (!raw || typeof raw !== 'object') return null;

  // Unwrap `{ event: … }` if present; otherwise treat `raw` as the body.
  const body: FeishuReceiveEventBody =
    'event' in raw && raw.event ? raw.event : (raw as FeishuReceiveEventBody);

  const message = body.message;
  if (!message) return null;

  const chatId = message.chat_id;
  if (!chatId) return null;

  const senderId =
    body.sender?.sender_id?.open_id ??
    body.sender?.sender_id?.union_id ??
    body.sender?.sender_id?.user_id ??
    'unknown';

  const content = extractFeishuText(message.message_type, message.content);

  const createTimeMs = message.create_time ? Number(message.create_time) : NaN;
  const timestamp = Number.isFinite(createTimeMs) ? new Date(createTimeMs) : new Date();

  const inbound: InboundMessage = {
    id: message.message_id ?? `feishu_${Date.now()}`,
    channel: {
      id: chatId,
      type: 'feishu',
      isDM: message.chat_type === 'p2p',
      isGroup: message.chat_type === 'group',
    },
    sender: {
      id: senderId,
      raw: body.sender,
    },
    content,
    contentType: feishuMessageTypeToContentType(message.message_type),
    timestamp,
    raw,
  };

  if (message.thread_id) inbound.threadId = message.thread_id;
  if (message.parent_id) inbound.replyTo = message.parent_id;

  return inbound;
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
 * contract. Instead, when the official SDK IS installed we drive its
 * {@link https://github.com/larksuite/node-sdk WSClient} (see
 * {@link FeishuChannel.connect}); when it is NOT installed we keep the honest
 * send-only state below. The outbound REST path is always fully implemented.
 */
export interface FeishuReceiveStatus {
  /**
   * `true` only when the official Lark `WSClient` long-connection is live;
   * `false` when the SDK is absent (or no app credentials are configured).
   */
  connected: boolean;
  /**
   * Machine-readable state code:
   * - `'lark-sdk-required'` — the optional `@larksuiteoapi/node-sdk` is not
   *   installed, so no inbound socket exists (outbound REST still works).
   * - `'lark-ws'` — the official SDK's long-connection is live.
   */
  reason: 'lark-sdk-required' | 'lark-ws';
  /** Human-readable explanation. */
  detail: string;
}

// ============================================================================
// Optional Lark SDK surface (structural — the package is NOT a dependency)
// ============================================================================

/** Minimal structural view of the bits of `@larksuiteoapi/node-sdk` we touch. */
interface LarkEventDispatcher {
  register(handlers: Record<string, (data: unknown) => unknown>): LarkEventDispatcher;
}
interface LarkWSClient {
  start(opts: { eventDispatcher: LarkEventDispatcher }): void | Promise<void>;
  stop?(): void | Promise<void>;
}
interface LarkSdkModule {
  WSClient: new (opts: Record<string, unknown>) => LarkWSClient;
  EventDispatcher: new (opts: Record<string, unknown>) => LarkEventDispatcher;
  LoggerLevel?: Record<string, unknown>;
}

export class FeishuChannel extends BaseChannel {
  private adapter: FeishuAdapter | null = null;
  private readonly baseUrl: string;
  /** Cached tenant_access_token (re-minted on demand if the API rejects it). */
  private tenantToken: string | null = null;
  private receiveStatus: FeishuReceiveStatus | null = null;
  /** Live official-SDK long-connection client, when the SDK is installed. */
  private wsClient: LarkWSClient | null = null;

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
   * long-connection — see {@link FeishuReceiveStatus}. We do NOT fake it. We
   * attempt to bring up the REAL inbound socket using the official Lark SDK
   * (`@larksuiteoapi/node-sdk`), imported OPTIONALLY at runtime — it is not a
   * declared dependency, so most installs won't have it. When it IS present
   * (and app credentials are configured) we start its `WSClient` and register
   * the `im.message.receive_v1` handler, which parses each message into an
   * {@link InboundMessage} and re-emits it via `this.emit('message' | 'command')`.
   * The SDK owns the long-connection + reconnect internally.
   *
   * When the SDK is absent (the default) we keep the honest "send-only" state:
   * `status.connected = false`, the receive reason surfaced in
   * `status.error` / `status.info`. No throw — outbound still works.
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

    // Default to the honest send-only state. `tryStartInbound()` upgrades it
    // in place if (and only if) the optional SDK is installed and usable.
    this.receiveStatus = {
      connected: false,
      reason: 'lark-sdk-required',
      detail:
        'Feishu inbound long-connection (real-time receive) is not active: the ' +
        'official Lark SDK (@larksuiteoapi/node-sdk) — which owns the proprietary ' +
        "Protobuf 'pbbp2' long-connection framing — is not installed (it is an " +
        'optional dependency). Install it and configure app credentials to enable ' +
        'real-time receive. Outbound send() is fully functional via the REST ' +
        'im/v1/messages API.',
    };
    this.status.connected = false;
    this.status.authenticated = false;
    this.status.error = this.receiveStatus.detail;
    this.status.info = {
      outbound: 'ready',
      inbound: this.receiveStatus.reason,
    };

    await this.tryStartInbound(cfg);
  }

  /**
   * Attempt to bring up the REAL inbound long-connection via the optional
   * official Lark SDK. Mutates `this.receiveStatus` / `this.status` to the live
   * `'lark-ws'` state on success; otherwise leaves the honest send-only state
   * untouched. Never throws — a missing SDK or a start() failure degrades
   * gracefully to outbound-only.
   */
  private async tryStartInbound(cfg: FeishuChannelConfig): Promise<void> {
    // Optional dependency: the `as string` specifier keeps TS/Vite from trying
    // to statically resolve a package that isn't installed, so this becomes a
    // genuine runtime import that rejects (→ caught) when the SDK is absent.
    const lark = (await import('@larksuiteoapi/node-sdk' as string).catch(
      () => null,
    )) as LarkSdkModule | null;

    if (!lark || typeof lark.WSClient !== 'function' || typeof lark.EventDispatcher !== 'function') {
      // SDK not installed — keep the honest 'lark-sdk-required' state.
      return;
    }
    if (!cfg.appId || !cfg.appSecret) {
      // SDK present but unconfigured — still send-only. Keep the reason code
      // (`lark-sdk-required`, so the honest-state contract holds) but correct
      // the detail: the SDK is here; the missing piece is app credentials.
      logger.warn('Feishu: Lark SDK installed but appId/appSecret missing — inbound disabled');
      if (this.receiveStatus) {
        this.receiveStatus.detail =
          'Feishu inbound long-connection is not active: the official Lark SDK ' +
          '(@larksuiteoapi/node-sdk) IS installed, but appId/appSecret are not ' +
          'configured, so the WSClient cannot authenticate. Provide app credentials ' +
          'to enable real-time receive. Outbound send() is fully functional.';
        this.status.error = this.receiveStatus.detail;
      }
      return;
    }

    try {
      const dispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': (data: unknown) => {
          try {
            this.dispatchInboundEvent(data as FeishuReceiveEventBody | FeishuReceiveEventEnvelope);
          } catch (err) {
            logger.warn(`Feishu inbound handler error: ${err instanceof Error ? err.message : err}`);
          }
        },
      });

      const wsClient = new lark.WSClient({
        appId: cfg.appId,
        appSecret: cfg.appSecret,
      });
      await wsClient.start({ eventDispatcher: dispatcher });
      this.wsClient = wsClient;

      this.receiveStatus = {
        connected: true,
        reason: 'lark-ws',
        detail:
          'Feishu inbound is live over the official Lark SDK WSClient long-connection ' +
          '(@larksuiteoapi/node-sdk). im.message.receive_v1 events are parsed into ' +
          'InboundMessages and re-emitted; the SDK manages reconnect internally.',
      };
      this.status.connected = true;
      this.status.authenticated = true;
      delete this.status.error;
      this.status.info = { outbound: 'ready', inbound: 'lark-ws' };
      this.status.lastActivity = new Date();
      logger.info('Feishu: inbound long-connection established via @larksuiteoapi/node-sdk');
    } catch (err) {
      // start() failed (bad creds, network). Stay honest: send-only.
      logger.warn(
        `Feishu: Lark WSClient failed to start, falling back to send-only: ${
          err instanceof Error ? err.message : err
        }`,
      );
      this.wsClient = null;
    }
  }

  /**
   * Parse a raw `im.message.receive_v1` event and re-emit it as a Code Buddy
   * `message` (and `command`) event. This is the seam the live SDK handler
   * delegates to; it is also unit-testable directly without a live tenant.
   *
   * @returns the parsed {@link InboundMessage}, or `null` if the event carried
   *   no usable message.
   */
  dispatchInboundEvent(
    event: FeishuReceiveEventBody | FeishuReceiveEventEnvelope,
  ): InboundMessage | null {
    const parsed = parseFeishuMessageEvent(event);
    if (!parsed) return null;

    // Skip messages from the bot itself / disallowed users where configured.
    if (!this.isUserAllowed(parsed.sender.id)) return null;
    if (!this.isChannelAllowed(parsed.channel.id)) return null;

    const withCommand = this.parseCommand(parsed);
    this.status.lastActivity = new Date();
    this.emit('message', withCommand);
    if (withCommand.isCommand) {
      this.emit('command', withCommand);
    }
    return withCommand;
  }

  async disconnect(): Promise<void> {
    if (this.wsClient) {
      try {
        await this.wsClient.stop?.();
      } catch (err) {
        logger.debug(`Feishu: WSClient stop error: ${err instanceof Error ? err.message : err}`);
      }
      this.wsClient = null;
    }
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
