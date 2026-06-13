/**
 * QQ Channel Adapter
 *
 * Publishes outbound Code Buddy messages through a OneBot v11-compatible
 * HTTP gateway, a common protocol surface for QQ bot runtimes.
 */

import { logger } from '../../utils/logger.js';
import { BaseChannel, ChannelConfig, DeliveryResult, OutboundMessage } from '../core.js';

export type QQMessageType = 'private' | 'group';

export interface QQConfig {
  baseUrl?: string;
  accessToken?: string;
  defaultMessageType?: QQMessageType;
  autoEscape?: boolean;
}

export interface QQChannelConfig extends ChannelConfig {
  baseUrl?: string;
  accessToken?: string;
  defaultMessageType?: QQMessageType;
  autoEscape?: boolean;
}

export interface QQSendOptions {
  messageType?: QQMessageType;
  autoEscape?: boolean;
}

export interface QQSendResult {
  messageId?: string;
  retcode?: number;
  status?: string;
  success: boolean;
}

interface QQPayload {
  auto_escape: boolean;
  group_id?: number | string;
  message: string;
  user_id?: number | string;
}

interface QQTarget {
  id: number | string;
  type: QQMessageType;
}

type QQChannelData = Partial<QQSendOptions>;

export class QQAdapter {
  private readonly config: Required<Pick<QQConfig, 'baseUrl'>> & Omit<QQConfig, 'baseUrl'>;
  private running = false;

  constructor(config: QQConfig = {}) {
    this.config = {
      ...config,
      baseUrl: normalizeBaseUrl(config.baseUrl ?? 'http://127.0.0.1:5700'),
      defaultMessageType: config.defaultMessageType ?? 'private',
      autoEscape: config.autoEscape ?? true,
    };
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('QQAdapter is already running');
    }
    new URL(this.config.baseUrl);
    logger.debug('QQAdapter: ready', sanitizeBaseInfo(this.config.baseUrl));
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      throw new Error('QQAdapter is not running');
    }
    logger.debug('QQAdapter: stopping');
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  getBaseInfo(): Record<string, unknown> {
    return sanitizeBaseInfo(this.config.baseUrl);
  }

  getConfig(): QQConfig {
    return { ...this.config };
  }

  async send(target: string, content: string, options: QQSendOptions = {}): Promise<QQSendResult> {
    if (!this.running) {
      throw new Error('QQAdapter is not running');
    }

    const resolvedTarget = resolveTarget(target, options.messageType ?? this.config.defaultMessageType ?? 'private');
    const action = resolvedTarget.type === 'group' ? 'send_group_msg' : 'send_private_msg';
    const response = await fetch(buildActionUrl(this.config.baseUrl, action), {
      method: 'POST',
      headers: buildHeaders(this.config.accessToken),
      body: JSON.stringify(buildPayload(resolvedTarget, content, options.autoEscape ?? this.config.autoEscape ?? true)),
    });
    const responseText = await response.text();
    const body = parseJsonObject(responseText);
    const retcode = typeof body.retcode === 'number' ? body.retcode : undefined;
    const status = typeof body.status === 'string' ? body.status : undefined;

    if (!response.ok || (retcode !== undefined && retcode !== 0) || (status !== undefined && status !== 'ok')) {
      const message = typeof body.message === 'string'
        ? body.message
        : typeof body.wording === 'string'
          ? body.wording
          : responseText.trim() || 'empty response';
      throw new Error(`QQ OneBot send failed (${response.status}${retcode !== undefined ? `/${retcode}` : ''}): ${message}`);
    }

    return {
      messageId: extractMessageId(body),
      retcode,
      status,
      success: true,
    };
  }
}

export class QQChannel extends BaseChannel {
  private adapter: QQAdapter;
  private readonly defaultMessageType?: QQMessageType;
  private readonly defaultAutoEscape?: boolean;

  constructor(config: QQChannelConfig) {
    super('qq', {
      type: 'qq',
      enabled: config.enabled,
      token: config.token,
      webhookUrl: config.webhookUrl,
      allowedUsers: config.allowedUsers,
      allowedChannels: config.allowedChannels,
      autoReply: config.autoReply,
      rateLimit: config.rateLimit,
      options: config.options,
    });
    this.defaultMessageType = config.defaultMessageType;
    this.defaultAutoEscape = config.autoEscape;
    this.adapter = new QQAdapter({
      baseUrl: config.baseUrl ?? config.webhookUrl,
      accessToken: config.accessToken ?? config.token,
      defaultMessageType: config.defaultMessageType,
      autoEscape: config.autoEscape,
    });
  }

  // REST adapter — outbound messages are one-shot HTTP POSTs to a OneBot v11
  // gateway; there is no persistent connection held open here, so reconnection
  // (ReconnectionManager) is N/A.
  async connect(): Promise<void> {
    await this.adapter.start();
    this.status.connected = true;
    this.status.authenticated = true;
    this.status.lastActivity = new Date();
    this.status.info = this.adapter.getBaseInfo();
    this.emit('connected', this.type);
  }

  async disconnect(): Promise<void> {
    if (!this.status.connected) return;
    await this.adapter.stop();
    this.status.connected = false;
    this.status.authenticated = false;
    this.status.lastActivity = new Date();
    this.emit('disconnected', this.type);
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    try {
      const channelData = extractQQChannelData(message);
      const result = await this.adapter.send(message.channelId, this.formatMessage(message.content, message.parseMode), {
        messageType: channelData.messageType ?? this.defaultMessageType,
        autoEscape: channelData.autoEscape ?? this.defaultAutoEscape,
      });
      this.status.lastActivity = new Date();
      return {
        success: result.success,
        messageId: result.messageId,
        timestamp: new Date(),
      };
    } catch (error) {
      this.status.error = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: this.status.error,
        timestamp: new Date(),
      };
    }
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('QQ OneBot baseUrl is required');
  }
  return trimmed;
}

function resolveTarget(target: string, fallbackType: QQMessageType): QQTarget {
  const trimmed = target.trim();
  const match = /^(private|user|u|group|g):(.+)$/i.exec(trimmed);
  const type = match?.[1]?.toLowerCase();
  const rawId = match ? match[2]!.trim() : trimmed;
  if (!rawId) {
    throw new Error('QQ target id is required');
  }
  return {
    id: normalizeQQId(rawId),
    type: type === 'group' || type === 'g' ? 'group' : type ? 'private' : fallbackType,
  };
}

function normalizeQQId(value: string): number | string {
  return /^\d+$/.test(value) ? Number(value) : value;
}

function buildActionUrl(baseUrl: string, action: string): string {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/g, '');
  url.pathname = `${basePath}/${action}`;
  return url.toString();
}

function buildHeaders(accessToken: string | undefined): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: normalizeAuthorization(accessToken) } : {}),
  };
}

function normalizeAuthorization(accessToken: string): string {
  const trimmed = accessToken.trim();
  return /^(bearer|token)\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

function buildPayload(target: QQTarget, message: string, autoEscape: boolean): QQPayload {
  return {
    message,
    auto_escape: autoEscape,
    ...(target.type === 'group' ? { group_id: target.id } : { user_id: target.id }),
  };
}

function extractQQChannelData(message: OutboundMessage): QQChannelData {
  const raw = message.channelData?.qq;
  if (!isRecord(raw)) return {};
  return {
    messageType: raw.messageType === 'group' || raw.messageType === 'private' ? raw.messageType : undefined,
    autoEscape: typeof raw.autoEscape === 'boolean' ? raw.autoEscape : undefined,
  };
}

function sanitizeBaseInfo(baseUrl: string): Record<string, unknown> {
  const url = new URL(baseUrl);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return {
    oneBotOrigin: url.origin,
    ...(url.pathname !== '/' ? { oneBotPath: url.pathname } : {}),
  };
}

function extractMessageId(body: Record<string, unknown>): string | undefined {
  const data = isRecord(body.data) ? body.data : {};
  const messageId = data.message_id;
  return typeof messageId === 'number' || typeof messageId === 'string' ? String(messageId) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export default QQAdapter;
